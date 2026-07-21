import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthOptions, IdentityProvider } from './auth.js';
import { buildApp } from './app.js';
import type { GoogleIdentity } from './repository.js';
import { MemoryRepository } from './repository.js';

class FakeIdentityProvider implements IdentityProvider {
  readonly identities = new Map<string, GoogleIdentity>();

  createAuthorizationUrl(input: { state: string; nonce: string; codeChallenge: string }) {
    const url = new URL('https://accounts.example.test/authorize');
    url.search = new URLSearchParams({
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  async exchangeCode(input: { code: string; codeVerifier: string; expectedNonce: string }) {
    assert.ok(input.codeVerifier.length >= 43);
    assert.ok(input.expectedNonce.length >= 43);
    const identity = this.identities.get(input.code);
    if (!identity) throw new Error('Unknown fake authorization code');
    return identity;
  }
}

test('OAuth sessions isolate athlete data, support logout, and enforce admin role', async () => {
  const repository = new MemoryRepository();
  const provider = new FakeIdentityProvider();
  provider.identities.set('athlete-one', {
    subject: 'google-athlete-one',
    email: 'one@example.com',
    displayName: 'Athlete One',
    avatarUrl: null,
  });
  provider.identities.set('athlete-two', {
    subject: 'google-athlete-two',
    email: 'two@example.com',
    displayName: 'Athlete Two',
    avatarUrl: null,
  });
  provider.identities.set('admin', {
    subject: 'google-admin',
    email: 'admin@example.com',
    displayName: 'Admin',
    avatarUrl: null,
  });
  const auth: AuthOptions = {
    provider,
    adminEmails: new Set(['admin@example.com']),
    secureCookies: false,
    sessionTtlMs: 30 * 24 * 60 * 60 * 1_000,
  };
  const app = buildApp(repository, { auth });
  await app.ready();

  const anonymousHistory = await app.inject({ method: 'GET', url: '/api/v1/workouts' });
  assert.equal(anonymousHistory.statusCode, 401);

  const athleteOneCookie = await logIn(app, 'athlete-one');
  const athleteTwoCookie = await logIn(app, 'athlete-two');
  const adminCookie = await logIn(app, 'admin');

  const athleteOneProfile = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { cookie: athleteOneCookie },
  });
  assert.equal(athleteOneProfile.statusCode, 200);
  assert.equal(athleteOneProfile.json().user.role, 'athlete');

  const adminProfile = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { cookie: adminCookie },
  });
  assert.equal(adminProfile.json().user.role, 'admin');

  const workoutId = '20000000-0000-4000-8000-000000000001';
  const workout = {
    id: workoutId,
    clientMutationId: '30000000-0000-4000-8000-000000000001',
    startedAt: '2026-07-20T08:00:00.000Z',
    locale: 'ru',
  };
  const firstWorkout = await app.inject({
    method: 'POST',
    url: '/api/v1/workouts',
    headers: { cookie: athleteOneCookie },
    payload: workout,
  });
  assert.equal(firstWorkout.statusCode, 201);
  const repeatedWorkout = await app.inject({
    method: 'POST',
    url: '/api/v1/workouts',
    headers: { cookie: athleteOneCookie },
    payload: workout,
  });
  assert.equal(repeatedWorkout.statusCode, 200);
  assert.equal(repeatedWorkout.json().duplicate, true);

  const set = {
    clientMutationId: '40000000-0000-4000-8000-000000000001',
    workoutId,
    set: {
      id: '50000000-0000-4000-8000-000000000001',
      exerciseId: '10000000-0000-4000-8000-000000000001',
      weightKg: 60,
      reps: 10,
      rir: 2,
      comment: 'Чисто',
      performedAt: '2026-07-20T08:12:00.000Z',
    },
  };
  const firstSet = await app.inject({
    method: 'POST',
    url: '/api/v1/sets',
    headers: { cookie: athleteOneCookie },
    payload: set,
  });
  assert.equal(firstSet.statusCode, 201);

  const athleteOneHistory = await app.inject({
    method: 'GET',
    url: '/api/v1/workouts',
    headers: { cookie: athleteOneCookie },
  });
  assert.equal(athleteOneHistory.json().items[0].setCount, 1);

  const athleteTwoHistory = await app.inject({
    method: 'GET',
    url: '/api/v1/workouts',
    headers: { cookie: athleteTwoCookie },
  });
  assert.deepEqual(athleteTwoHistory.json().items, []);
  const crossUserSet = await app.inject({
    method: 'POST',
    url: '/api/v1/sets',
    headers: { cookie: athleteTwoCookie },
    payload: { ...set, clientMutationId: '40000000-0000-4000-8000-000000000002' },
  });
  assert.equal(crossUserSet.statusCode, 404);

  const athleteAdminRequest = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/users',
    headers: { cookie: athleteOneCookie },
  });
  assert.equal(athleteAdminRequest.statusCode, 403);
  const adminUsers = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/users',
    headers: { cookie: adminCookie },
  });
  assert.equal(adminUsers.statusCode, 200);
  assert.equal(adminUsers.json().items.length, 3);

  const logout = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { cookie: athleteOneCookie },
  });
  assert.equal(logout.statusCode, 204);
  const loggedOutProfile = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { cookie: athleteOneCookie },
  });
  assert.equal(loggedOutProfile.statusCode, 401);

  await app.close();
});

test('OAuth state is bound to its cookie and can only be consumed once', async () => {
  const repository = new MemoryRepository();
  const provider = new FakeIdentityProvider();
  provider.identities.set('athlete', {
    subject: 'google-athlete',
    email: 'athlete@example.com',
    displayName: 'Athlete',
    avatarUrl: null,
  });
  const auth: AuthOptions = {
    provider,
    adminEmails: new Set(),
    secureCookies: false,
    sessionTtlMs: 30 * 24 * 60 * 60 * 1_000,
  };
  const app = buildApp(repository, { auth });
  await app.ready();

  const start = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/google?returnTo=//evil.test',
  });
  const location = new URL(start.headers.location ?? '');
  const state = location.searchParams.get('state');
  assert.ok(state);
  const stateCookie = cookieValue(start.headers['set-cookie'], 'mc_oauth_state');

  const wrongState = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/google/callback?code=athlete&state=wrong',
    headers: { cookie: stateCookie },
  });
  assert.equal(wrongState.statusCode, 400);

  const callbackUrl = `/api/v1/auth/google/callback?code=athlete&state=${encodeURIComponent(state)}`;
  const callback = await app.inject({
    method: 'GET',
    url: callbackUrl,
    headers: { cookie: stateCookie },
  });
  assert.equal(callback.statusCode, 302);
  assert.equal(callback.headers.location, '/');

  const replay = await app.inject({
    method: 'GET',
    url: callbackUrl,
    headers: { cookie: stateCookie },
  });
  assert.equal(replay.statusCode, 400);

  await app.close();
});

async function logIn(app: ReturnType<typeof buildApp>, code: string) {
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google?returnTo=/' });
  assert.equal(start.statusCode, 302);
  const location = new URL(start.headers.location ?? '');
  const state = location.searchParams.get('state');
  assert.ok(state);
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');

  const stateCookie = cookieValue(start.headers['set-cookie'], 'mc_oauth_state');
  const callback = await app.inject({
    method: 'GET',
    url: `/api/v1/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    headers: { cookie: stateCookie },
  });
  assert.equal(callback.statusCode, 302);
  assert.equal(callback.headers.location, '/');
  return cookieValue(callback.headers['set-cookie'], 'mc_session');
}

function cookieValue(header: string | string[] | undefined, name: string) {
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));
  assert.ok(cookie, `Expected ${name} cookie`);
  return cookie.split(';', 1)[0];
}
