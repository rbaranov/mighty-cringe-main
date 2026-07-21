import { randomUUID } from 'node:crypto';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import {
  createMeasurementSchema,
  createSetSchema,
  createWorkoutSchema,
  deleteMeasurementSchema,
  deleteSetSchema,
  syncMutationSchema,
  trainerAthleteIdSchema,
  trainerInviteAcceptSchema,
  trainerInviteCreateSchema,
  trainerInviteIdSchema,
  updateMeasurementSchema,
  updateSetSchema,
  updateWorkoutSchema,
  voiceEntryIdSchema,
} from '@mighty-cringe/contracts';
import {
  audioFormatFromMimeType,
  maximumVoiceBytes,
  maximumVoiceDurationSeconds,
  voiceConsentVersion,
  type VoiceStorage,
} from '@mighty-cringe/voice';
import Fastify, { type FastifyBaseLogger, type FastifyReply, type FastifyRequest } from 'fastify';

import { codeChallenge, hashToken, randomToken, type AuthOptions } from './auth.js';
import {
  RepositoryConflictError,
  RepositoryInviteError,
  RepositoryNotFoundError,
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
  voiceStorage?: VoiceStorage;
  voiceProcessingEnabled?: boolean;
  now?: () => Date;
};

export function buildApp(repository: WorkoutRepository, options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: maximumVoiceBytes });
  const now = options.now ?? (() => new Date());

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

  app.get('/api/v1/exercises', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    return { items: await repository.listExercises() };
  });

  app.get('/api/v1/workouts', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    return { items: await repository.listWorkouts(user.id) };
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
          ? 'OpenRouter'
          : null,
    };
  });

  app.get('/api/v1/voice-entries', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    return { items: await repository.listVoiceEntries(user.id) };
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
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });

    const parsed = createWorkoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const result = await repository.createWorkout(user.id, parsed.data);
    return reply.status(result.duplicate ? 200 : 201).send(result);
  });

  app.patch('/api/v1/workouts/:workoutId', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });

    const workoutId = (request.params as { workoutId?: unknown }).workoutId;
    const parsed = updateWorkoutSchema.safeParse({
      ...(request.body as object),
      workoutId,
    });
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    try {
      return await repository.updateWorkout(user.id, parsed.data);
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.post('/api/v1/sets', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });

    const parsed = createSetSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    try {
      const result = await repository.createSet(user.id, parsed.data);
      return reply.status(result.duplicate ? 200 : 201).send(result);
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.patch('/api/v1/sets/:setId', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });

    const setId = (request.params as { setId?: unknown }).setId;
    const parsed = updateSetSchema.safeParse({ ...(request.body as object), setId });
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    try {
      return await repository.updateSet(user.id, parsed.data);
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.delete('/api/v1/sets/:setId', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });

    const setId = (request.params as { setId?: unknown }).setId;
    const parsed = deleteSetSchema.safeParse({ ...(request.body as object), setId });
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    try {
      return await repository.deleteSet(user.id, parsed.data);
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.get('/api/v1/measurements', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    return { items: await repository.listMeasurements(user.id) };
  });

  app.post('/api/v1/measurements', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    const parsed = createMeasurementSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      const result = await repository.createMeasurement(user.id, parsed.data);
      return reply.status(result.duplicate ? 200 : 201).send(result);
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.patch('/api/v1/measurements/:measurementId', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    const measurementId = (request.params as { measurementId?: unknown }).measurementId;
    const parsed = updateMeasurementSchema.safeParse({
      ...(request.body as object),
      measurementId,
    });
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      return await repository.updateMeasurement(user.id, parsed.data);
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.delete('/api/v1/measurements/:measurementId', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });
    const measurementId = (request.params as { measurementId?: unknown }).measurementId;
    const parsed = deleteMeasurementSchema.safeParse({
      ...(request.body as object),
      measurementId,
    });
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      return await repository.deleteMeasurement(user.id, parsed.data);
    } catch (error) {
      return sendRepositoryError(reply, error);
    }
  });

  app.post('/api/v1/sync', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });

    const parsed = syncMutationSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    try {
      let result;
      switch (parsed.data.type) {
        case 'workout.create':
          result = await repository.createWorkout(user.id, parsed.data.payload);
          break;
        case 'workout.update':
          result = await repository.updateWorkout(user.id, parsed.data.payload);
          break;
        case 'set.create':
          result = await repository.createSet(user.id, parsed.data.payload);
          break;
        case 'set.update':
          result = await repository.updateSet(user.id, parsed.data.payload);
          break;
        case 'set.delete':
          result = await repository.deleteSet(user.id, parsed.data.payload);
          break;
        case 'measurement.create':
          result = await repository.createMeasurement(user.id, parsed.data.payload);
          break;
        case 'measurement.update':
          result = await repository.updateMeasurement(user.id, parsed.data.payload);
          break;
        case 'measurement.delete':
          result = await repository.deleteMeasurement(user.id, parsed.data.payload);
          break;
      }
      const created =
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

async function getCurrentUser(request: FastifyRequest, repository: WorkoutRepository, now: Date) {
  const sessionToken = request.cookies[sessionCookieName];
  if (!sessionToken) return null;
  return repository.getSessionUser(hashToken(sessionToken), now);
}

function safeReturnTo(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function sendRepositoryError(reply: FastifyReply, error: unknown) {
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
