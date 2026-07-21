import { randomUUID } from 'node:crypto';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { createSetSchema, createWorkoutSchema, syncMutationSchema } from '@mighty-cringe/contracts';
import Fastify, { type FastifyBaseLogger, type FastifyRequest } from 'fastify';

import { codeChallenge, hashToken, randomToken, type AuthOptions } from './auth.js';
import type { WorkoutRepository } from './repository.js';

const sessionCookieName = 'mc_session';
const oauthStateCookieName = 'mc_oauth_state';
const oauthCallbackPath = '/api/v1/auth/google/callback';
const oauthAttemptTtlMs = 10 * 60 * 1_000;

type AppOptions = {
  logger?: FastifyBaseLogger;
  auth?: AuthOptions;
  now?: () => Date;
};

export function buildApp(repository: WorkoutRepository, options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const now = options.now ?? (() => new Date());

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
      const requestedRole = options.auth.adminEmails.has(identity.email.toLowerCase())
        ? 'admin'
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

  app.post('/api/v1/workouts', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });

    const parsed = createWorkoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const result = await repository.createWorkout(user.id, parsed.data);
    return reply.status(result.duplicate ? 200 : 201).send(result);
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
      return reply
        .status(404)
        .send({ error: error instanceof Error ? error.message : 'Not found' });
    }
  });

  app.post('/api/v1/sync', async (request, reply) => {
    const user = await getCurrentUser(request, repository, now());
    if (!user) return reply.status(401).send({ error: 'Authentication required' });

    const parsed = syncMutationSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    try {
      const result =
        parsed.data.type === 'workout.create'
          ? await repository.createWorkout(user.id, parsed.data.payload)
          : await repository.createSet(user.id, parsed.data.payload);
      return reply.status(result.duplicate ? 200 : 201).send({ ...result, type: parsed.data.type });
    } catch (error) {
      return reply
        .status(409)
        .send({ error: error instanceof Error ? error.message : 'Sync failed' });
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
