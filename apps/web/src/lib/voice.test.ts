import 'fake-indexeddb/auto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from './db';
import {
  acceptVoiceConsent,
  classifyVoiceLocalSaveFailure,
  flushVoiceQueue,
  hasAcceptedVoiceConsent,
  loadVoiceConfig,
  queueVoiceRecording,
  refreshVoiceEntries,
  requestVoiceDeletion,
  revokeVoiceConsent,
  waitForVoiceEntry,
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

  it('remembers consent for the current version and asks again after revocation or a new version', async () => {
    await expect(hasAcceptedVoiceConsent('2026-07-26')).resolves.toBe(false);
    await acceptVoiceConsent('2026-07-26');
    await expect(hasAcceptedVoiceConsent('2026-07-26')).resolves.toBe(true);
    await expect(hasAcceptedVoiceConsent('2026-08-01')).resolves.toBe(false);
    await revokeVoiceConsent();
    await expect(hasAcceptedVoiceConsent('2026-07-26')).resolves.toBe(false);
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

  it('classifies only real quota failures as missing device space', () => {
    expect(classifyVoiceLocalSaveFailure(new DOMException('full', 'QuotaExceededError'))).toBe(
      'quota',
    );
    expect(classifyVoiceLocalSaveFailure({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe('quota');
    expect(classifyVoiceLocalSaveFailure(new DOMException('failed', 'UnknownError'))).toBe(
      'storage',
    );
    expect(classifyVoiceLocalSaveFailure(new Error('status refresh failed'))).toBe('storage');
  });

  it('merges a confirmed transcript without rewriting or removing the retained audio', async () => {
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
    const update = vi.spyOn(db.voiceEntries, 'update');

    await expect(refreshVoiceEntries()).resolves.toBe('success');

    expect(update).toHaveBeenCalled();
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('audio');
    const entry = await db.voiceEntries.get(id);
    expect(entry).toMatchObject({ status: 'confirmed', transcript: 'жим 40 на 12' });
    expect(entry?.audio).toBeInstanceOf(Blob);
  });

  it('polls a pending entry until the server transcript is confirmed without using HTTP cache', async () => {
    await queueVoiceRecording({
      id,
      workoutId,
      audio: new Blob(['private-audio'], { type: 'audio/webm' }),
      consentVersion: '2026-07-22',
      now: new Date(createdAt),
    });
    await db.voiceEntries.update(id, { status: 'pending', serverStored: true });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [serverEntry('pending')] }))
      .mockResolvedValueOnce(
        Response.json({ items: [{ ...serverEntry('confirmed'), transcript: 'жим 40 на 12' }] }),
      );
    vi.stubGlobal('fetch', request);

    await expect(waitForVoiceEntry(id, { intervalMs: 0 })).resolves.toMatchObject({
      status: 'confirmed',
      transcript: 'жим 40 на 12',
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, '/api/v1/voice-entries', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
  });

  it('stops polling immediately when the voice panel is closed', async () => {
    await queueVoiceRecording({
      id,
      workoutId,
      audio: new Blob(['private-audio'], { type: 'audio/webm' }),
      consentVersion: '2026-07-22',
      now: new Date(createdAt),
    });
    await db.voiceEntries.update(id, { status: 'pending', serverStored: true });
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', request);
    const controller = new AbortController();

    const polling = waitForVoiceEntry(id, { intervalMs: 60_000, signal: controller.signal });
    controller.abort();

    await expect(polling).resolves.toMatchObject({ status: 'pending' });
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps a saved recording queued when a later local sync step fails', async () => {
    await queueVoiceRecording({
      id,
      workoutId,
      audio: new Blob(['private-audio'], { type: 'audio/webm' }),
      consentVersion: '2026-07-22',
      now: new Date(createdAt),
    });
    const update = vi.spyOn(db.voiceEntries, 'update').mockRejectedValueOnce(new Error('failed'));

    await expect(flushVoiceQueue()).resolves.toBe('retry');

    update.mockRestore();
    expect(await db.voiceEntries.get(id)).toMatchObject({
      status: 'queued',
      serverStored: false,
    });
  });

  it('treats a malformed status refresh as retryable instead of a local save failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{', { status: 200 })),
    );

    await expect(refreshVoiceEntries()).resolves.toBe('retry');
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
