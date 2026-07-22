import assert from 'node:assert/strict';
import { test } from 'node:test';

import { voiceConsentVersion, type VoiceStorage } from '@mighty-cringe/voice';

import { buildApp } from './app.js';
import { hashToken } from './auth.js';
import { MemoryRepository } from './repository.js';

class MemoryVoiceStorage implements VoiceStorage {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  async put(key: string, body: Uint8Array, contentType: string) {
    this.objects.set(key, { body: Uint8Array.from(body), contentType });
  }

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error('Object not found');
    return object.body;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}

test('voice audio is private, consent-bound, and deletable', async () => {
  const repository = new MemoryRepository();
  const storage = new MemoryVoiceStorage();
  const app = buildApp(repository, { voiceStorage: storage });
  const athlete = await repository.upsertGoogleUser(
    {
      subject: 'voice-athlete',
      email: 'voice@example.com',
      displayName: 'Voice Athlete',
      avatarUrl: null,
    },
    'athlete',
  );
  const other = await repository.upsertGoogleUser(
    {
      subject: 'other-athlete',
      email: 'other@example.com',
      displayName: 'Other Athlete',
      avatarUrl: null,
    },
    'athlete',
  );
  await repository.createSession({
    id: '70000000-0000-4000-8000-000000000001',
    tokenHash: hashToken('voice-session'),
    userId: athlete.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  await repository.createSession({
    id: '70000000-0000-4000-8000-000000000002',
    tokenHash: hashToken('other-session'),
    userId: other.id,
    expiresAt: new Date(Date.now() + 60_000),
  });

  const id = '71000000-0000-4000-8000-000000000001';
  const missingConsent = await app.inject({
    method: 'POST',
    url: `/api/v1/voice-entries/${id}/audio`,
    headers: { cookie: 'mc_session=voice-session', 'content-type': 'audio/webm' },
    payload: Buffer.from('audio'),
  });
  assert.equal(missingConsent.statusCode, 400);

  const uploaded = await app.inject({
    method: 'POST',
    url: `/api/v1/voice-entries/${id}/audio`,
    headers: {
      cookie: 'mc_session=voice-session',
      'content-type': 'audio/webm;codecs=opus',
      'x-voice-consent-version': voiceConsentVersion,
    },
    payload: Buffer.from('private-audio'),
  });
  assert.equal(uploaded.statusCode, 202, uploaded.body);
  assert.equal(storage.objects.size, 1);
  const [objectKey] = storage.objects.keys();
  assert.equal(objectKey, `${athlete.id}/${id}/source.webm`);

  const ownList = await app.inject({
    method: 'GET',
    url: '/api/v1/voice-entries',
    headers: { cookie: 'mc_session=voice-session' },
  });
  assert.equal(ownList.statusCode, 200);
  assert.deepEqual(
    ownList.json().items.map((entry: { id: string }) => entry.id),
    [id],
  );
  assert.equal(JSON.stringify(ownList.json()).includes('objectKey'), false);

  const ownAudio = await app.inject({
    method: 'GET',
    url: `/api/v1/voice-entries/${id}/audio`,
    headers: { cookie: 'mc_session=voice-session' },
  });
  assert.equal(ownAudio.statusCode, 200);
  assert.equal(ownAudio.headers['cache-control'], 'private, no-store');
  assert.equal(ownAudio.body, 'private-audio');

  const otherAudio = await app.inject({
    method: 'GET',
    url: `/api/v1/voice-entries/${id}/audio`,
    headers: { cookie: 'mc_session=other-session' },
  });
  assert.equal(otherAudio.statusCode, 404);

  const otherList = await app.inject({
    method: 'GET',
    url: '/api/v1/voice-entries',
    headers: { cookie: 'mc_session=other-session' },
  });
  assert.deepEqual(otherList.json().items, []);
  const forbiddenDelete = await app.inject({
    method: 'DELETE',
    url: `/api/v1/voice-entries/${id}`,
    headers: { cookie: 'mc_session=other-session' },
  });
  assert.equal(forbiddenDelete.statusCode, 404);
  assert.equal(storage.objects.size, 1);

  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/v1/voice-entries/${id}`,
    headers: { cookie: 'mc_session=voice-session' },
  });
  assert.equal(removed.statusCode, 204);
  assert.equal(storage.objects.size, 0);

  await app.close();
  await repository.close();
});
