import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from './app.js';
import { hashToken } from './auth.js';
import { MemoryRepository } from './repository.js';

test('profile language and units are authenticated, validated, and persisted', async () => {
  const repository = new MemoryRepository();
  const now = new Date('2026-07-22T10:00:00.000Z');
  const app = buildApp(repository, { now: () => now });
  const user = await repository.upsertGoogleUser(
    {
      subject: 'preferences-user',
      email: 'preferences@example.com',
      displayName: 'Preferences Athlete',
      avatarUrl: null,
    },
    'athlete',
  );
  await repository.createSession({
    id: '73000000-0000-4000-8000-000000000001',
    tokenHash: hashToken('preferences-session'),
    userId: user.id,
    expiresAt: new Date('2026-07-23T10:00:00.000Z'),
  });
  const headers = { cookie: 'mc_session=preferences-session' };

  const anonymous = await app.inject({
    method: 'PATCH',
    url: '/api/v1/me/preferences',
    payload: { locale: 'en', unitSystem: 'imperial' },
  });
  assert.equal(anonymous.statusCode, 401);

  const invalid = await app.inject({
    method: 'PATCH',
    url: '/api/v1/me/preferences',
    headers,
    payload: { locale: 'de', unitSystem: 'stones' },
  });
  assert.equal(invalid.statusCode, 400);

  const updated = await app.inject({
    method: 'PATCH',
    url: '/api/v1/me/preferences',
    headers,
    payload: { locale: 'en', unitSystem: 'imperial' },
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.deepEqual(updated.json().user, {
    ...user,
    locale: 'en',
    unitSystem: 'imperial',
  });

  const restored = await app.inject({ method: 'GET', url: '/api/v1/me', headers });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(restored.json().user.locale, 'en');
  assert.equal(restored.json().user.unitSystem, 'imperial');

  await app.close();
  await repository.close();
});
