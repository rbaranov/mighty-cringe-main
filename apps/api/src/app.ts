import { randomUUID } from 'node:crypto';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import {
  createExerciseSchema,
  createMeasurementSchema,
  createSetSchema,
  createWorkoutSchema,
  deletePushSubscriptionSchema,
  deleteMeasurementSchema,
  deleteSetSchema,
  deleteWorkoutSchema,
  exerciseDiscoveryQuerySchema,
  exerciseIdSchema,
  startExerciseDiscoverySchema,
  syncMutationSchema,
  pushSubscriptionSchema,
  trainerAthleteIdSchema,
  trainerInviteAcceptSchema,
  trainerInviteCreateSchema,
  trainerInviteIdSchema,
  updateTrainerAccessSchema,
  updateMeasurementSchema,
  updateNotificationPreferencesSchema,
  updateExerciseSchema,
  updateSetSchema,
  updateUserPreferencesSchema,
  updateWorkoutSchema,
  voiceEntryIdSchema,
  type CurrentUser,
} from '@mighty-cringe/contracts';
import {
  audioFormatFromMimeType,
  maximumVoiceBytes,
  maximumVoiceDurationSeconds,
  voiceConsentVersion,
  type VoiceStorage,
} from '@mighty-cringe/voice';
import { nextNotificationAt } from '@mighty-cringe/push';
import Fastify, { type FastifyBaseLogger, type FastifyReply, type FastifyRequest } from 'fastify';

import { codeChallenge, hashToken, randomToken, type AuthOptions } from './auth.js';
import type { ExerciseDiscovery } from './exerciseDiscovery.js';
import { ExerciseDiscoveryJobs } from './exerciseDiscoveryJobs.js';
import {
  RepositoryConflictError,
  RepositoryInviteError,
  RepositoryNotFoundError,
  RepositoryTrainerAccessError,
  type WorkoutRepository,
} from './repository.js';

const sessionCookieName = 'mc_session';
const oauthStateCookieName = 'mc_oauth_state';
const oauthCallbackPath = '/api/v1/auth/google/callback';
const oauthAttemptTtlMs = 10 * 60 * 1_000;
const trainerInviteTtlMs = 7 * 24 * 60 * 60 * 1_000;

type AppOptions = {
  logger?: FastifyBaseLogger;
  auth?: AuthOptions;
  developmentUser?: CurrentUser;
  voiceStorage?: VoiceStorage;
  voiceProcessingEnabled?: boolean;
  voiceProvider?: string;
  pushPublicKey?: string | null;
  exerciseDiscovery?: ExerciseDiscovery;
  now?: () => Date;
};

export function buildApp(repository: WorkoutRepository, options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: maximumVoiceBytes });
  const now = options.now ?? (() => new Date());
  const exerciseDiscoveryJobs = options.exerciseDiscovery
    ? new ExerciseDiscoveryJobs(options.exerciseDiscovery, now)
    : null;
  app.decorate('developmentUser', options.developmentUser ?? null);

  app.addContentTypeParser(
    /^audio\/[a-z0-9.+-]+(?:\s*;.*)?$/i,
    { parseAs: 'buffer', bodyLimit: maximumVoiceBytes },
    (_request, body, done) => done(null, body),
  );

  void app.register(cookie);
  void app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });

  app.addHook('onRoute', (route) => {
    const handler = route.handler;
    route.handler = async function (request, reply) {
      const expectedActorId = request.headers['x-actor-id'];
      if (expectedActorId !== undefined) {
        if (!trainerAthleteIdSchema.safeParse(expectedActorId).success) {
          return reply
            .status(400)
            .send({ code: 'invalid_actor_context', error: 'A valid actor identifier is required' });
        }
        const actor = await getCurrentUser(request, repository, now());
        if (actor?.id !== expectedActorId) {
          return reply.status(403).send({
            code: 'actor_session_changed',
            error: 'The signed-in account changed. Reload before continuing.',
          });
        }
      }
      const athleteId = request.headers['x-athlete-id'];
      const linkId = request.headers['x-trainer-link-id'];
      if (athleteId === undefined && linkId === undefined)
        return handler.call(this, request, reply);
      if (!isSportingRoute(route.url)) {
        return reply.status(403).send({
          code: 'trainer_scope_forbidden',
          error: 'Athlete context is only valid for sporting data',
        });
      }
      if (
        !trainerAthleteIdSchema.safeParse(athleteId).success ||
        !trainerInviteIdSchema.safeParse(linkId).success
      ) {
        return reply.status(400).send({
          code: 'invalid_trainer_context',
          error: 'Both athlete and trainer link identifiers are required',
        });
      }
      if (
        route.url === '/api/v1/exercises/:exerciseId' &&
        ['PUT', 'DELETE'].includes(request.method) &&
        parseExerciseRevision(request) === undefined
      ) {
        return reply.status(428).send({
          code: 'exercise_revision_required',
          error: 'Reload the exercise before editing it',
        });
      }
      const actor = await getCurrentUser(request, repository, now());
      if (!actor) return reply.status(401).send({ error: 'Authentication required' });
      // Defer sending until the transaction, authorization and audit have committed.
      const send = reply.send;
      let staged = false;
      let payload: unknown;
      reply.send = function (value: unknown) {
        staged = true;
        payload = value;
        return value as FastifyReply;
      };
      try {
        const result = await repository.withTrainerAccess(
          {
            actorId: actor.id,
            athleteId: athleteId as string,
            linkId: linkId as string,
            write: request.method !== 'GET' && request.method !== 'HEAD',
            operation: sportingAction(request.method, route.url, request.body),
            details: { params: request.params, body: request.body ?? null },
          },
          async () => {
            const references = sportingExerciseReferences(request.body);
            if (references.length) {
              const available = new Set(
                (await repository.listExercises(athleteId as string)).map(
                  (exercise) => exercise.id,
                ),
              );
              if (references.some((id) => !available.has(id))) throw new RepositoryNotFoundError();
            }
            const value = await handler.call(this, request, reply);
            const response = staged ? payload : value;
            const duplicate = Boolean(
              response &&
              typeof response === 'object' &&
              'duplicate' in response &&
              response.duplicate,
            );
            return { value, successful: reply.statusCode < 400 && !duplicate };
          },
        );
        reply.send = send;
        return staged ? reply.send(payload) : result;
      } catch (error) {
        reply.send = send;
        return sendRepositoryError(reply, error);
      } finally {
        reply.send = send;
      }
    };
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/api/v1/auth/config', async () => ({ googleEnabled: Boolean(options.auth) }));

  app.get('/api/v1/auth/google', async (request, reply) => {
    if (!options.auth) {
      return reply.status(503).send({ error: 'Google authentication is not configured' });
    }

    const query = request.query as { returnTo?: unknown };
    const returnTo = safeReturnTo(query.returnTo);
    const state = randomToken();
    const verifier = randomToken();
    const nonce = randomToken();
    await repository.createAuthAttempt({
      stateHash: hashToken(state),
      codeVerifier: verifier,
      nonce,
      returnTo,
      expiresAt: new Date(now().getTime() + oauthAttemptTtlMs),
    });

    reply.setCookie(oauthStateCookieName, state, {
      httpOnly: true,
      secure: options.auth.secureCookies,
      sameSite: 'lax',
      path: oauthCallbackPath,
      maxAge: Math.floor(oauthAttemptTtlMs / 1_000),
    });
    return reply.redirect(
      options.auth.provider.createAuthorizationUrl({
        state,
        nonce,
        codeChallenge: codeChallenge(verifier),
      }),
    );
  });

  app.get(oauthCallbackPath, async (request, reply) => {
    if (!options.auth) {
      return reply.status(503).send({ error: 'Google authentication is not configured' });
    }

    const clearStateCookie = () =>
      reply.clearCookie(oauthStateCookieName, {
        path: oauthCallbackPath,
        secure: options.auth?.secureCookies,
        sameSite: 'lax',
      });
    const query = request.query as { code?: unknown; state?: unknown; error?: unknown };
    if (typeof query.error === 'string') {
      clearStateCookie();
      return reply.redirect('/?authError=access_denied');
    }
    if (typeof query.code !== 'string' || typeof query.state !== 'string') {
      clearStateCookie();
      return reply.status(400).send({ error: 'Invalid OAuth callback' });
    }

    const cookieState = request.cookies[oauthStateCookieName];
    if (!cookieState || hashToken(cookieState) !== hashToken(query.state)) {
      clearStateCookie();
      return reply.status(400).send({ error: 'Invalid OAuth state' });
    }

    const attempt = await repository.consumeAuthAttempt(hashToken(query.state), now());
    if (!attempt) {
      clearStateCookie();
      return reply.status(400).send({ error: 'OAuth attempt expired or was already used' });
    }

    try {
      const identity = await options.auth.provider.exchangeCode({
        code: query.code,
        codeVerifier: attempt.codeVerifier,
        expectedNonce: attempt.nonce,
      });
      const normalizedEmail = identity.email.toLowerCase();
      const requestedRole = options.auth.adminEmails.has(normalizedEmail)
        ? 'admin'
        : options.auth.trainerEmails.has(normalizedEmail)
          ? 'trainer'
          : 'athlete';
      const user = await repository.upsertGoogleUser(identity, requestedRole);
      const sessionToken = randomToken();
      const expiresAt = new Date(now().getTime() + options.auth.sessionTtlMs);
      await repository.createSession({
        id: randomUUID(),
        tokenHash: hashToken(sessionToken),
        userId: user.id,
        expiresAt,
      });

      clearStateCookie();
      reply.setCookie(sessionCookieName, sessionToken, {
        httpOnly: true,
        secure: options.auth.secureCookies,
        sameSite: 'lax',
        path: '/',
        maxAge: Math.floor(options.auth.sessionTtlMs / 1_000),
      });
      return reply.redirect(attempt.returnTo);
    } catch (error) {
      request.log.error({ err: error }, 'OAuth callback failed');
      clearStateCookie();
      return reply.redirect('/?authError=failed');
    }
  });

  app.get('/api/v1/me', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    return { user };
  });

  app.patch('/api/v1/me/preferences', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    const parsed = updateUserPreferencesSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    return { user: await repository.updateUserPreferences(user.id, parsed.data) };
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const sessionToken = request.cookies[sessionCookieName];
    if (sessionToken) await repository.revokeSession(hashToken(sessionToken), now());
    reply.clearCookie(sessionCookieName, {
      path: '/',
      secure: options.auth?.secureCookies,
      sameSite: 'lax',
    });
    return reply.status(204).send();
  });

  app.post('/api/v1/trainer/invites', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    if (!canUseTrainerConsole(user.role)) {
      return reply.status(403).send({ error: 'Trainer role required' });
    }
    const parsed = trainerInviteCreateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const token = randomToken();
    const currentTime = now();
    const invite = await repository.createTrainerInvite(
      {
        id: randomUUID(),
        trainerId: user.id,
        email: parsed.data.email,
        tokenHash: hashToken(token),
        expiresAt: new Date(currentTime.getTime() + trainerInviteTtlMs),
      },
      currentTime,
    );
    return reply.status(201).send({ invite, token });
  });

  app.get('/api/v1/trainer/invites', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    if (!canUseTrainerConsole(user.role)) {
      return reply.status(403).send({ error: 'Trainer role required' });
    }
    return { items: await repository.listTrainerInvites(user.id, now()) };
  });

  app.delete('/api/v1/trainer/invites/:inviteId', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    if (!canUseTrainerConsole(user.role)) {
      return reply.status(403).send({ error: 'Trainer role required' });
    }
    const inviteId = trainerInviteIdSchema.safeParse(
      (request.params as { inviteId?: unknown }).inviteId,
    );
    if (!inviteId.success) return reply.status(400).send({ error: 'Invalid invite id' });
    const revoked = await repository.revokeTrainerInvite(user.id, inviteId.data, now());
    return revoked
      ? reply.status(204).send()
      : reply.status(404).send({ error: 'Pending invite not found' });
  });

  app.post('/api/v1/trainer/invites/accept', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    const parsed = trainerInviteAcceptSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      const trainer = await repository.acceptTrainerInvite(
        hashToken(parsed.data.token),
        user.id,
        user.email,
        now(),
      );
      return { trainer };
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.get('/api/v1/trainer/relationship', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    return { trainer: await repository.getAthleteTrainer(user.id) };
  });

  app.patch('/api/v1/trainer/relationship', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    const input = updateTrainerAccessSchema.safeParse(request.body);
    if (!input.success) return reply.status(400).send({ error: input.error.flatten() });
    try {
      return { trainer: await repository.updateTrainerAccess(user.id, input.data.access, now()) };
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.get('/api/v1/trainer/athletes/:athleteId/context', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    if (!canUseTrainerConsole(user.role))
      return reply.status(403).send({ error: 'Trainer role required' });
    const id = trainerAthleteIdSchema.safeParse(
      (request.params as { athleteId?: unknown }).athleteId,
    );
    if (!id.success) return reply.status(400).send({ error: 'Invalid athlete id' });
    const athlete = (await repository.listTrainerAthletes(user.id)).find(
      (item) => item.id === id.data,
    );
    return athlete
      ? { athlete }
      : reply
          .status(403)
          .send({ code: 'trainer_access_revoked', error: 'Trainer access is no longer available' });
  });

  app.delete('/api/v1/trainer/relationship', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    const revoked = await repository.revokeAthleteTrainer(user.id, now());
    return revoked
      ? reply.status(204).send()
      : reply.status(404).send({ error: 'Active trainer not found' });
  });

  app.get('/api/v1/trainer/athletes', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    if (!canUseTrainerConsole(user.role)) {
      return reply.status(403).send({ error: 'Trainer role required' });
    }
    return { items: await repository.listTrainerAthletes(user.id) };
  });

  app.delete('/api/v1/trainer/athletes/:athleteId', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    if (!canUseTrainerConsole(user.role)) {
      return reply.status(403).send({ error: 'Trainer role required' });
    }
    const athleteId = trainerAthleteIdSchema.safeParse(
      (request.params as { athleteId?: unknown }).athleteId,
    );
    if (!athleteId.success) return reply.status(400).send({ error: 'Invalid athlete id' });
    const revoked = await repository.revokeTrainerAthlete(user.id, athleteId.data, now());
    return revoked
      ? reply.status(204).send()
      : reply.status(404).send({ error: 'Linked athlete not found' });
  });

  app.get('/api/v1/trainer/athletes/:athleteId/workouts', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    if (!canUseTrainerConsole(user.role)) {
      return reply.status(403).send({ error: 'Trainer role required' });
    }
    const athleteId = trainerAthleteIdSchema.safeParse(
      (request.params as { athleteId?: unknown }).athleteId,
    );
    if (!athleteId.success) return reply.status(400).send({ error: 'Invalid athlete id' });
    try {
      return { items: await repository.listSharedWorkouts(user.id, athleteId.data) };
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.get('/api/v1/trainer/athletes/:athleteId/measurements', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    if (!canUseTrainerConsole(user.role)) {
      return reply.status(403).send({ error: 'Trainer role required' });
    }
    const athleteId = trainerAthleteIdSchema.safeParse(
      (request.params as { athleteId?: unknown }).athleteId,
    );
    if (!athleteId.success) return reply.status(400).send({ error: 'Invalid athlete id' });
    try {
      return { items: await repository.listSharedMeasurements(user.id, athleteId.data) };
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.get('/api/v1/journal-activity', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });
    return { items: await repository.listJournalActivity(ownerId) };
  });

  app.get('/api/v1/exercises', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });
    return { items: await repository.listExercises(ownerId) };
  });

  app.get('/api/v1/exercise-preferences', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });
    return { items: await repository.listExercisePreferences(ownerId) };
  });

  app.post('/api/v1/exercises/discover', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });
    if (!options.exerciseDiscovery) {
      return reply.status(503).send({ error: 'Online exercise discovery is not configured' });
    }
    const input = exerciseDiscoveryQuerySchema.safeParse(request.body);
    if (!input.success) return reply.status(400).send({ error: input.error.flatten() });
    try {
      return await options.exerciseDiscovery.discover(input.data.query, input.data.locale);
    } catch (error) {
      request.log.error({ err: error }, 'Exercise discovery failed');
      return reply.status(502).send({ error: 'Exercise discovery provider is unavailable' });
    }
  });

  app.post('/api/v1/exercise-discoveries', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });
    if (!exerciseDiscoveryJobs) {
      return reply.status(503).send({ error: 'Online exercise discovery is not configured' });
    }
    const input = startExerciseDiscoverySchema.safeParse(request.body);
    if (!input.success) return reply.status(400).send({ error: input.error.flatten() });
    const exercise = input.data.exerciseId
      ? (await repository.listExercises(ownerId)).find(
          (item) => item.id === input.data.exerciseId && item.scope === 'user' && !item.deletedAt,
        )
      : undefined;
    if (input.data.exerciseId) {
      if (!exercise) return reply.status(404).send({ error: 'Personal exercise not found' });
    }
    return reply.status(202).send({
      job: exerciseDiscoveryJobs.start(
        ownerId,
        input.data.query,
        input.data.locale,
        exercise
          ? {
              nameRu: exercise.nameRu,
              nameEn: exercise.nameEn,
              aliases: exercise.aliases,
              primaryMuscles: exercise.primaryMuscles,
              secondaryMuscles: exercise.secondaryMuscles,
              equipment: exercise.equipment,
              notes: exercise.notes,
            }
          : undefined,
      ),
    });
  });

  app.get('/api/v1/exercise-discoveries/:jobId', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });
    const jobId = exerciseIdSchema.safeParse((request.params as { jobId?: unknown }).jobId);
    if (!jobId.success) return reply.status(400).send({ error: 'Invalid discovery id' });
    const job = exerciseDiscoveryJobs?.get(ownerId, jobId.data);
    return job ? { job } : reply.status(404).send({ error: 'Discovery not found' });
  });

  app.delete('/api/v1/exercise-discoveries/:jobId', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });
    const jobId = exerciseIdSchema.safeParse((request.params as { jobId?: unknown }).jobId);
    if (!jobId.success) return reply.status(400).send({ error: 'Invalid discovery id' });
    const job = exerciseDiscoveryJobs?.cancel(ownerId, jobId.data);
    return job
      ? reply.status(204).send()
      : reply.status(404).send({ error: 'Discovery not found' });
  });

  app.post('/api/v1/exercises', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });
    const input = createExerciseSchema.safeParse(request.body);
    if (!input.success) return reply.status(400).send({ error: input.error.flatten() });
    try {
      const exercise = await repository.createExercise(ownerId, input.data);
      return reply.status(201).send({ exercise });
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.put('/api/v1/exercises/:exerciseId', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });
    const exerciseId = exerciseIdSchema.safeParse(
      (request.params as { exerciseId?: unknown }).exerciseId,
    );
    if (!exerciseId.success) return reply.status(400).send({ error: 'Invalid exercise id' });
    const input = updateExerciseSchema.safeParse(request.body);
    if (!input.success) return reply.status(400).send({ error: input.error.flatten() });
    try {
      const exercise = await repository.updateExercise(
        ownerId,
        exerciseId.data,
        input.data,
        parseExerciseRevision(request),
      );
      return reply.send({ exercise });
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.delete('/api/v1/exercises/:exerciseId', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });
    const exerciseId = exerciseIdSchema.safeParse(
      (request.params as { exerciseId?: unknown }).exerciseId,
    );
    if (!exerciseId.success) return reply.status(400).send({ error: 'Invalid exercise id' });
    try {
      const exercise = await repository.deleteExercise(
        ownerId,
        exerciseId.data,
        now(),
        parseExerciseRevision(request),
      );
      return reply.send({ exercise });
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.get('/api/v1/workouts', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });
    return { items: await repository.listWorkouts(ownerId) };
  });

  app.get('/api/v1/voice/config', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    return {
      enabled: Boolean(options.voiceStorage) && options.voiceProcessingEnabled !== false,
      consentVersion: voiceConsentVersion,
      maximumBytes: maximumVoiceBytes,
      maximumSeconds: maximumVoiceDurationSeconds,
      provider:
        Boolean(options.voiceStorage) && options.voiceProcessingEnabled !== false
          ? (options.voiceProvider ?? 'OpenRouter')
          : null,
    };
  });

  app.get('/api/v1/voice-entries', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    return reply
      .header('cache-control', 'private, no-store')
      .send({ items: await repository.listVoiceEntries(user.id) });
  });

  app.get('/api/v1/notifications/config', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    return { enabled: Boolean(options.pushPublicKey), publicKey: options.pushPublicKey ?? null };
  });

  app.get('/api/v1/notifications/preferences', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    return { preferences: await repository.getNotificationPreferences(user.id) };
  });

  app.patch('/api/v1/notifications/preferences', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    const parsed = updateNotificationPreferencesSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    if (parsed.data.enabled && !options.pushPublicKey) {
      return reply.status(503).send({ error: 'Push notifications are not configured' });
    }
    try {
      const nextReminderAt = parsed.data.enabled ? nextNotificationAt(parsed.data, now()) : null;
      const preferences = await repository.updateNotificationPreferences(
        user.id,
        parsed.data,
        nextReminderAt,
      );
      return { preferences };
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'Invalid notification schedule',
      });
    }
  });

  app.post('/api/v1/notifications/subscriptions', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    if (!options.pushPublicKey) {
      return reply.status(503).send({ error: 'Push notifications are not configured' });
    }
    const parsed = pushSubscriptionSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    await repository.upsertPushSubscription(user.id, parsed.data, now());
    return reply.status(201).send();
  });

  app.delete('/api/v1/notifications/subscriptions', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    const parsed = deletePushSubscriptionSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    await repository.deletePushSubscription(user.id, parsed.data.endpoint);
    return reply.status(204).send();
  });

  app.get('/api/v1/voice-entries/:voiceEntryId/audio', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    if (!options.voiceStorage) {
      return reply.status(503).send({ error: 'Private voice storage is not configured' });
    }
    const voiceEntryId = voiceEntryIdSchema.safeParse(
      (request.params as { voiceEntryId?: unknown }).voiceEntryId,
    );
    if (!voiceEntryId.success) return reply.status(400).send({ error: 'Invalid voice entry id' });
    const object = await repository.getVoiceObject(user.id, voiceEntryId.data);
    if (!object) return reply.status(404).send({ error: 'Voice entry not found' });
    const audio = await options.voiceStorage.get(object.objectKey);
    return reply
      .header('cache-control', 'private, no-store')
      .type(object.mimeType)
      .send(Buffer.from(audio));
  });

  app.post('/api/v1/voice-entries/:voiceEntryId/audio', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    if (!options.voiceStorage || options.voiceProcessingEnabled === false) {
      return reply.status(503).send({ error: 'Private voice processing is not configured' });
    }

    const voiceEntryId = voiceEntryIdSchema.safeParse(
      (request.params as { voiceEntryId?: unknown }).voiceEntryId,
    );
    const query = request.query as { workoutId?: unknown };
    const workoutId =
      query.workoutId === undefined || query.workoutId === ''
        ? { success: true as const, data: null }
        : voiceEntryIdSchema.safeParse(query.workoutId);
    if (!voiceEntryId.success || !workoutId.success) {
      return reply.status(400).send({ error: 'Invalid voice entry or workout id' });
    }
    if (request.headers['x-voice-consent-version'] !== voiceConsentVersion) {
      return reply.status(400).send({ error: 'Current voice consent is required' });
    }

    const contentType = request.headers['content-type']?.trim().toLowerCase() ?? '';
    const audioFormat = audioFormatFromMimeType(contentType);
    const body = request.body;
    if (!audioFormat || !Buffer.isBuffer(body) || body.length === 0) {
      return reply.status(400).send({ error: 'A supported non-empty audio body is required' });
    }
    if (body.length > maximumVoiceBytes) {
      return reply.status(413).send({ error: 'Voice recording is too large' });
    }

    const objectKey = `${user.id}/${voiceEntryId.data}/source.${audioFormat}`;
    await options.voiceStorage.put(objectKey, body, contentType);
    try {
      const entry = await repository.createVoiceEntry(user.id, {
        id: voiceEntryId.data,
        workoutId: workoutId.data,
        objectKey,
        mimeType: contentType,
        audioFormat,
        sizeBytes: body.length,
        consentVersion: voiceConsentVersion,
      });
      return reply.status(202).send({ entry });
    } catch (error) {
      await options.voiceStorage.delete(objectKey).catch(() => undefined);
      return sendRepositoryError(reply, error);
    }
  });

  app.delete('/api/v1/voice-entries/:voiceEntryId', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    if (!options.voiceStorage) {
      return reply.status(503).send({ error: 'Private voice storage is not configured' });
    }
    const voiceEntryId = voiceEntryIdSchema.safeParse(
      (request.params as { voiceEntryId?: unknown }).voiceEntryId,
    );
    if (!voiceEntryId.success) return reply.status(400).send({ error: 'Invalid voice entry id' });
    const object = await repository.getVoiceObject(user.id, voiceEntryId.data);
    if (!object) return reply.status(404).send({ error: 'Voice entry not found' });
    await options.voiceStorage.delete(object.objectKey);
    await repository.deleteVoiceEntry(user.id, voiceEntryId.data);
    return reply.status(204).send();
  });

  app.post('/api/v1/workouts', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });

    const parsed = createWorkoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const result = await repository.createWorkout(ownerId, parsed.data);
    return reply.status(result.duplicate ? 200 : 201).send(result);
  });

  app.patch('/api/v1/workouts/:workoutId', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });

    const workoutId = (request.params as { workoutId?: unknown }).workoutId;
    const parsed = updateWorkoutSchema.safeParse({
      ...(request.body as object),
      workoutId,
    });
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    try {
      return await repository.updateWorkout(ownerId, parsed.data);
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.delete('/api/v1/workouts/:workoutId', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });

    const workoutId = (request.params as { workoutId?: unknown }).workoutId;
    const parsed = deleteWorkoutSchema.safeParse({ ...(request.body as object), workoutId });
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    try {
      return await repository.deleteWorkout(ownerId, parsed.data);
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.post('/api/v1/sets', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });

    const parsed = createSetSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    try {
      const result = await repository.createSet(ownerId, parsed.data);
      return reply.status(result.duplicate ? 200 : 201).send(result);
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.patch('/api/v1/sets/:setId', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });

    const setId = (request.params as { setId?: unknown }).setId;
    const parsed = updateSetSchema.safeParse({ ...(request.body as object), setId });
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    try {
      return await repository.updateSet(ownerId, parsed.data);
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.delete('/api/v1/sets/:setId', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });

    const setId = (request.params as { setId?: unknown }).setId;
    const parsed = deleteSetSchema.safeParse({ ...(request.body as object), setId });
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    try {
      return await repository.deleteSet(ownerId, parsed.data);
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.get('/api/v1/measurements', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });
    return { items: await repository.listMeasurements(ownerId) };
  });

  app.post('/api/v1/measurements', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });
    const parsed = createMeasurementSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      const result = await repository.createMeasurement(ownerId, parsed.data);
      return reply.status(result.duplicate ? 200 : 201).send(result);
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.patch('/api/v1/measurements/:measurementId', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });
    const measurementId = (request.params as { measurementId?: unknown }).measurementId;
    const parsed = updateMeasurementSchema.safeParse({
      ...(request.body as object),
      measurementId,
    });
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      return await repository.updateMeasurement(ownerId, parsed.data);
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.delete('/api/v1/measurements/:measurementId', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });
    const measurementId = (request.params as { measurementId?: unknown }).measurementId;
    const parsed = deleteMeasurementSchema.safeParse({
      ...(request.body as object),
      measurementId,
    });
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      return await repository.deleteMeasurement(ownerId, parsed.data);
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.post('/api/v1/sync', async (request, reply) => {
    const ownerId = await getSportingOwnerId(request, repository, now());
    if (!ownerId) return reply.status(401).send({ error: 'Authentication required' });

    const parsed = syncMutationSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    try {
      let result;
      switch (parsed.data.type) {
        case 'exercise.create': {
          const { clientMutationId: _clientMutationId, ...input } = parsed.data.payload;
          result = {
            entityType: 'exercise' as const,
            entity: await repository.createExercise(ownerId, input),
            duplicate: false,
          };
          break;
        }
        case 'exercise-preference.set':
          result = await repository.setExercisePreference(ownerId, parsed.data.payload);
          break;
        case 'workout.create':
          result = await repository.createWorkout(ownerId, parsed.data.payload);
          break;
        case 'workout.update':
          result = await repository.updateWorkout(ownerId, parsed.data.payload);
          break;
        case 'workout.touch':
          result = await repository.touchWorkout(ownerId, parsed.data.payload);
          break;
        case 'workout.delete':
          result = await repository.deleteWorkout(ownerId, parsed.data.payload);
          break;
        case 'set.create':
          result = await repository.createSet(ownerId, parsed.data.payload);
          break;
        case 'set.update':
          result = await repository.updateSet(ownerId, parsed.data.payload);
          break;
        case 'set.delete':
          result = await repository.deleteSet(ownerId, parsed.data.payload);
          break;
        case 'measurement.create':
          result = await repository.createMeasurement(ownerId, parsed.data.payload);
          break;
        case 'measurement.update':
          result = await repository.updateMeasurement(ownerId, parsed.data.payload);
          break;
        case 'measurement.delete':
          result = await repository.deleteMeasurement(ownerId, parsed.data.payload);
          break;
      }
      const created =
        parsed.data.type === 'exercise.create' ||
        parsed.data.type === 'workout.create' ||
        parsed.data.type === 'set.create' ||
        parsed.data.type === 'measurement.create';
      return reply
        .status(!result.duplicate && created ? 201 : 200)
        .send({ ...result, type: parsed.data.type });
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.get('/api/v1/admin/users', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      return reply.status(403).send({ error: 'Admin role required' });
    }
    return { items: await repository.listUsers() };
  });

  return app;
}

function sportingExerciseReferences(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const input = body as Record<string, unknown>;
  const references: string[] = [];
  if (typeof input.exerciseId === 'string') references.push(input.exerciseId);
  for (const key of ['payload', 'set', 'changes'])
    references.push(...sportingExerciseReferences(input[key]));
  if (Array.isArray(input.exercises)) {
    for (const item of input.exercises) references.push(...sportingExerciseReferences(item));
  }
  return references;
}

function sportingAction(method: string, route: string, body: unknown): string {
  if (route === '/api/v1/sync' && body && typeof body === 'object' && 'type' in body)
    return String(body.type);
  if (route === '/api/v1/exercises/discover') return 'exercise.discover';
  const kind = route.split('/')[3];
  const entity =
    (
      {
        workouts: 'workout',
        sets: 'set',
        measurements: 'measurement',
        exercises: 'exercise',
        'exercise-discoveries': 'exercise-discovery',
      } as Record<string, string>
    )[kind] ?? kind;
  const action =
    method === 'DELETE'
      ? entity === 'exercise-discovery'
        ? 'cancel'
        : 'delete'
      : method === 'POST'
        ? entity === 'exercise-discovery'
          ? 'start'
          : 'create'
        : 'update';
  return `${entity}.${action}`;
}

function parseExerciseRevision(request: FastifyRequest): number | undefined {
  const value = request.headers['if-match'];
  if (typeof value !== 'string' || !/^"?[1-9]\d*"?$/.test(value)) return undefined;
  const revision = Number(value.replaceAll('"', ''));
  return Number.isSafeInteger(revision) ? revision : undefined;
}

function isSportingRoute(url: string) {
  return /^\/api\/v1\/(?:workouts|sets|measurements|exercises|exercise-preferences|exercise-discoveries|sync|journal-activity)(?:\/|$)/.test(
    url,
  );
}

async function getSportingOwnerId(
  request: FastifyRequest,
  repository: WorkoutRepository,
  now: Date,
) {
  const actor = await getCurrentUser(request, repository, now);
  if (!actor) return null;
  return (request.headers['x-athlete-id'] as string | undefined) ?? actor.id;
}

async function getCurrentUser(request: FastifyRequest, repository: WorkoutRepository, now: Date) {
  const sessionToken = request.cookies[sessionCookieName];
  if (!sessionToken) return developmentUserFor(request);
  return (
    (await repository.getSessionUser(hashToken(sessionToken), now)) ?? developmentUserFor(request)
  );
}

function developmentUserFor(request: FastifyRequest) {
  return (
    (request.server as typeof request.server & { developmentUser?: CurrentUser | null })
      .developmentUser ?? null
  );
}

function safeReturnTo(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function sendRepositoryError(reply: FastifyReply, error: unknown) {
  if (error instanceof RepositoryTrainerAccessError) {
    return reply.status(403).send({ code: error.code, error: error.message });
  }
  if (error instanceof RepositoryInviteError) {
    const statusCode =
      error.code === 'invite_expired' ? 410 : error.code === 'invite_email_mismatch' ? 403 : 409;
    return reply.status(statusCode).send({ code: error.code, error: error.message });
  }
  if (error instanceof RepositoryConflictError) {
    return reply.status(409).send({
      code: 'revision_conflict',
      error: error.message,
      current: error.current,
    });
  }
  if (error instanceof RepositoryNotFoundError) {
    return reply.status(404).send({ code: 'not_found', error: error.message });
  }
  throw error;
}

function canUseTrainerConsole(role: string) {
  return role === 'trainer' || role === 'admin' || role === 'superadmin';
}
