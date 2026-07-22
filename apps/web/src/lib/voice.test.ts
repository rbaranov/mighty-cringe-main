import 'fake-indexeddb/auto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from './db';
import {
  flushVoiceQueue,
  loadVoiceConfig,
  queueVoiceRecording,
  refreshVoiceEntries,
  requestVoiceDeletion,
} from './voice';

const id = '82000000-0000-4000-8000-000000000001';
const workoutId = '83000000-0000-4000-8000-000000000001';
const createdAt = '2026-07-22T08:00:00.000Z';

describe('private durable voice queue', () => {
  beforeEach(async () => {
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
    vi.restoreAllMocks();
    vi.stubGlobal('navigator', { onLine: true });
  });
  afterAll(async () => db.delete());

  it('caches the server consent boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          enabled: true,
          consentVersion: '2026-07-22',
          maximumBytes: 10_485_760,
          maximumSeconds: 60,
          provider: 'OpenRouter',
        }),
      ),
    );

    await expect(loadVoiceConfig()).resolves.toMatchObject({ enabled: true, maximumSeconds: 60 });
    expect(await db.meta.get('voiceConfig')).toBeDefined();
  });

  it('stores audio locally before uploading it with explicit consent', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          entry: serverEntry('pending'),
        },
        { status: 202 },
      ),
    );
    vi.stubGlobal('fetch', request);

    await queueVoiceRecording({
      id,
      workoutId,
      audio: new Blob(['private-audio'], { type: 'audio/webm' }),
      consentVersion: '2026-07-22',
      now: new Date('2020-01-01T00:00:00.000Z'),
    });
    expect(await db.voiceEntries.get(id)).toMatchObject({ status: 'queued', serverStored: false });

    await expect(flushVoiceQueue()).resolves.toBe('success');

    const [url, init] = request.mock.calls[0];
    expect(url).toBe(`/api/v1/voice-entries/${id}/audio?workoutId=${workoutId}`);
    expect(init?.headers).toMatchObject({
      'content-type': 'audio/webm',
      'x-voice-consent-version': '2026-07-22',
    });
    expect(await db.voiceEntries.get(id)).toMatchObject({ status: 'pending', serverStored: true });
  });

  it('merges a confirmed transcript without removing the retained audio', async () => {
    await queueVoiceRecording({
      id,
      workoutId,
      audio: new Blob(['private-audio'], { type: 'audio/webm' }),
      consentVersion: '2026-07-22',
      now: new Date(createdAt),
    });
    await db.voiceEntries.update(id, { status: 'pending', serverStored: true });
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ items: [{ ...serverEntry('confirmed'), transcript: 'жим 40 на 12' }] }),
        ),
    );

    await expect(refreshVoiceEntries()).resolves.toBe('success');

    const entry = await db.voiceEntries.get(id);
    expect(entry).toMatchObject({ status: 'confirmed', transcript: 'жим 40 на 12' });
    expect(entry?.audio).toBeInstanceOf(Blob);
  });

  it('removes local audio immediately and retries server deletion', async () => {
    await queueVoiceRecording({
      id,
      workoutId,
      audio: new Blob(['private-audio'], { type: 'audio/webm' }),
      consentVersion: '2026-07-22',
      now: new Date(createdAt),
    });
    await db.voiceEntries.update(id, { status: 'confirmed', serverStored: true });
    vi.stubGlobal('navigator', { onLine: false });

    await expect(requestVoiceDeletion(id)).resolves.toBe('offline');
    expect(await db.voiceEntries.get(id)).toMatchObject({ status: 'deleting', audio: null });

    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })),
    );
    await expect(flushVoiceQueue()).resolves.toBe('success');
    expect(await db.voiceEntries.get(id)).toBeUndefined();
  });
});

function serverEntry(status: 'pending' | 'processing' | 'confirmed' | 'failed') {
  return {
    id,
    workoutId,
    status,
    transcript: null,
    createdAt,
    updatedAt: createdAt,
    lastError: null,
  };
}
