import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from './app.js';
import { hashToken } from './auth.js';
import { MemoryRepository } from './repository.js';

test('notification opt-in is explicit, user-scoped, and validates quiet hours', async () => {
  const repository = new MemoryRepository();
  const currentTime = new Date('2026-07-22T10:00:00.000Z');
  const app = buildApp(repository, {
    now: () => currentTime,
    pushPublicKey: 'public-vapid-key',
  });
  const user = await repository.upsertGoogleUser(
    {
      subject: 'push-user',
      email: 'push@example.com',
      displayName: 'Push Athlete',
      avatarUrl: null,
    },
    'athlete',
  );
  await repository.createSession({
    id: '72000000-0000-4000-8000-000000000001',
    tokenHash: hashToken('push-session'),
    userId: user.id,
    expiresAt: new Date('2026-07-23T10:00:00.000Z'),
  });
  const headers = { cookie: 'mc_session=push-session' };

  const anonymous = await app.inject({ method: 'GET', url: '/api/v1/notifications/preferences' });
  assert.equal(anonymous.statusCode, 401);

  const initial = await app.inject({
    method: 'GET',
    url: '/api/v1/notifications/preferences',
    headers,
  });
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.json().preferences.enabled, false);

  const invalidQuietTime = await app.inject({
    method: 'PATCH',
    url: '/api/v1/notifications/preferences',
    headers,
    payload: {
      enabled: true,
      frequency: 'daily',
      weekday: 1,
      reminderTime: '23:00',
      quietStart: '22:00',
      quietEnd: '08:00',
      timeZone: 'Asia/Almaty',
    },
  });
  assert.equal(invalidQuietTime.statusCode, 400);

  const saved = await app.inject({
    method: 'PATCH',
    url: '/api/v1/notifications/preferences',
    headers,
    payload: {
      enabled: true,
      frequency: 'daily',
      weekday: 1,
      reminderTime: '19:00',
      quietStart: '22:00',
      quietEnd: '08:00',
      timeZone: 'Asia/Almaty',
    },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().preferences.nextReminderAt, '2026-07-22T14:00:00.000Z');

  const subscription = {
    endpoint: 'https://push.example.test/subscription/one',
    expirationTime: null,
    keys: { p256dh: 'p'.repeat(64), auth: 'a'.repeat(32) },
  };
  const subscribed = await app.inject({
    method: 'POST',
    url: '/api/v1/notifications/subscriptions',
    headers,
    payload: subscription,
  });
  assert.equal(subscribed.statusCode, 201, subscribed.body);

  const removed = await app.inject({
    method: 'DELETE',
    url: '/api/v1/notifications/subscriptions',
    headers,
    payload: { endpoint: subscription.endpoint },
  });
  assert.equal(removed.statusCode, 204);

  const disabled = await app.inject({
    method: 'PATCH',
    url: '/api/v1/notifications/preferences',
    headers,
    payload: { ...saved.json().preferences, enabled: false, nextReminderAt: undefined },
  });
  assert.equal(disabled.statusCode, 200, disabled.body);
  assert.equal(disabled.json().preferences.nextReminderAt, null);

  await app.close();
  await repository.close();
});

test('notification opt-in stays unavailable until VAPID is configured', async () => {
  const repository = new MemoryRepository();
  const app = buildApp(repository);
  const user = await repository.upsertGoogleUser(
    {
      subject: 'disabled-push-user',
      email: 'disabled-push@example.com',
      displayName: 'Disabled Push Athlete',
      avatarUrl: null,
    },
    'athlete',
  );
  await repository.createSession({
    id: '72000000-0000-4000-8000-000000000002',
    tokenHash: hashToken('disabled-push-session'),
    userId: user.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  const response = await app.inject({
    method: 'PATCH',
    url: '/api/v1/notifications/preferences',
    headers: { cookie: 'mc_session=disabled-push-session' },
    payload: {
      enabled: true,
      frequency: 'daily',
      weekday: 1,
      reminderTime: '19:00',
      quietStart: '22:00',
      quietEnd: '08:00',
      timeZone: 'UTC',
    },
  });
  assert.equal(response.statusCode, 503);
  await app.close();
});
