import type { VoiceEntryRecord } from '@mighty-cringe/contracts';

import type { LocalVoiceEntry } from './db';
import {
  assertDataContext,
  getDataContext,
  isDataContextValid,
  sportingRequest,
  type DataContext,
} from './dataContext';

export type VoiceConfig = {
  enabled: boolean;
  consentVersion: string;
  maximumBytes: number;
  maximumSeconds: number;
  provider: string | null;
};

export type VoiceSyncOutcome = 'success' | 'offline' | 'retry' | 'unauthorized';
export type VoiceLocalSaveFailure = 'quota' | 'storage';
export type VoicePollOptions = {
  intervalMs?: number;
  signal?: AbortSignal;
};

const voiceConsentMetaKey = 'voiceConsentVersion';

const activeFlushes = new Map<DataContext, Promise<VoiceSyncOutcome>>();
const retryTimers = new Map<DataContext, ReturnType<typeof setTimeout>>();

export function isVoiceContextValid(context: DataContext) {
  return Boolean(context.actorId) && !context.relationshipId && isDataContextValid(context);
}

export function assertVoiceContext(context: DataContext) {
  assertDataContext(context);
  if (!context.actorId || context.relationshipId) throw new Error('voice_context_unavailable');
}

async function voiceRequest(input: string, init: RequestInit, context: DataContext) {
  assertVoiceContext(context);
  const response = await sportingRequest(input, init, context);
  assertVoiceContext(context);
  return response;
}

export async function loadVoiceConfig(context = getDataContext()): Promise<VoiceConfig | null> {
  if (!isVoiceContextValid(context)) return null;
  const db = context.database;
  if (browserOnline()) {
    try {
      const response = await voiceRequest(
        '/api/v1/voice/config',
        { credentials: 'same-origin' },
        context,
      );
      if (response.status === 401) {
        notifyUnauthorized();
        return null;
      }
      if (response.ok) {
        const config = parseVoiceConfig(await response.json());
        assertVoiceContext(context);
        if (config) {
          await db.meta.put({ key: 'voiceConfig', value: JSON.stringify(config) });
          assertVoiceContext(context);
          return config;
        }
      }
    } catch {
      if (!isVoiceContextValid(context)) return null;
      // A previously authenticated device may continue recording into its private local queue.
    }
  }

  const cached = await db.meta.get('voiceConfig');
  if (!isVoiceContextValid(context)) return null;
  if (!cached) return null;
  try {
    return parseVoiceConfig(JSON.parse(cached.value));
  } catch {
    return null;
  }
}

export async function hasAcceptedVoiceConsent(version: string, context = getDataContext()) {
  if (!isVoiceContextValid(context)) return false;
  const consent = await context.database.meta.get(voiceConsentMetaKey);
  return isVoiceContextValid(context) && consent?.value === version;
}

export async function acceptVoiceConsent(version: string, context = getDataContext()) {
  assertVoiceContext(context);
  await context.database.meta.put({ key: voiceConsentMetaKey, value: version });
  assertVoiceContext(context);
}

export async function revokeVoiceConsent(context = getDataContext()) {
  assertVoiceContext(context);
  await context.database.meta.delete(voiceConsentMetaKey);
  assertVoiceContext(context);
}

export async function queueVoiceRecording(
  input: {
    workoutId: string | null;
    audio: Blob;
    consentVersion: string;
    id?: string;
    now?: Date;
  },
  context = getDataContext(),
) {
  assertVoiceContext(context);
  const now = (input.now ?? new Date()).toISOString();
  const entry: LocalVoiceEntry = {
    id: input.id ?? crypto.randomUUID(),
    workoutId: input.workoutId,
    status: 'queued',
    transcript: null,
    audio: input.audio,
    mimeType: input.audio.type,
    consentVersion: input.consentVersion,
    serverStored: false,
    uploadAttempts: 0,
    retryable: true,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
    lastError: null,
  };
  await context.database.voiceEntries.put(entry);
  assertVoiceContext(context);
  return entry;
}

export function classifyVoiceLocalSaveFailure(error: unknown): VoiceLocalSaveFailure {
  if (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  ) {
    return 'quota';
  }
  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  ) {
    return 'quota';
  }
  return 'storage';
}

export function flushVoiceQueue(context = getDataContext()): Promise<VoiceSyncOutcome> {
  if (context.relationshipId) return Promise.resolve('success');
  if (!isVoiceContextValid(context)) return Promise.resolve('unauthorized');
  const running = activeFlushes.get(context);
  if (running) return running;
  const activeFlush = performFlush(context)
    .catch(() => {
      if (!isVoiceContextValid(context)) return 'unauthorized' as const;
      scheduleFlush(5_000, context);
      return 'retry' as const;
    })
    .finally(() => {
      activeFlushes.delete(context);
    });
  activeFlushes.set(context, activeFlush);
  return activeFlush;
}

export async function refreshVoiceEntries(context = getDataContext()): Promise<VoiceSyncOutcome> {
  if (context.relationshipId) return 'success';
  if (!isVoiceContextValid(context)) return 'unauthorized';
  const db = context.database;
  if (!browserOnline()) return 'offline';
  let response: Response;
  try {
    response = await voiceRequest(
      '/api/v1/voice-entries',
      {
        cache: 'no-store',
        credentials: 'same-origin',
      },
      context,
    );
  } catch {
    return isVoiceContextValid(context) ? 'retry' : 'unauthorized';
  }
  if (response.status === 401) {
    notifyUnauthorized();
    return 'unauthorized';
  }
  if (!response.ok) return 'retry';

  try {
    const payload = (await response.json()) as { items?: unknown };
    assertVoiceContext(context);
    if (!Array.isArray(payload.items)) return 'retry';
    const records = payload.items.map(parseVoiceEntry).filter(Boolean) as VoiceEntryRecord[];
    await db.transaction('rw', db.voiceEntries, async () => {
      assertVoiceContext(context);
      for (const record of records) {
        const local = await db.voiceEntries.get(record.id);
        assertVoiceContext(context);
        if (local?.status === 'deleting') continue;
        if (local) {
          await db.voiceEntries.update(record.id, {
            workoutId: record.workoutId,
            status: record.status,
            transcript: record.transcript,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            lastError: record.lastError,
            serverStored: true,
            retryable: false,
            nextAttemptAt: null,
          });
          continue;
        }
        await db.voiceEntries.put({
          ...record,
          audio: null,
          mimeType: '',
          consentVersion: '',
          serverStored: true,
          uploadAttempts: 0,
          retryable: false,
          nextAttemptAt: null,
        });
      }
    });
    assertVoiceContext(context);
    return 'success';
  } catch {
    return isVoiceContextValid(context) ? 'retry' : 'unauthorized';
  }
}

export async function waitForVoiceEntry(
  id: string,
  options: VoicePollOptions = {},
  context = getDataContext(),
): Promise<LocalVoiceEntry | undefined> {
  if (!isVoiceContextValid(context)) return undefined;
  const db = context.database;
  const intervalMs = options.intervalMs ?? 900;
  let entry = await db.voiceEntries.get(id);
  if (!isVoiceContextValid(context)) return undefined;
  while (entry && voiceEntryIsInProgress(entry) && !options.signal?.aborted) {
    const shouldContinue = await waitForPoll(intervalMs, options.signal);
    if (!isVoiceContextValid(context)) return undefined;
    if (!shouldContinue) break;
    await refreshVoiceEntries(context);
    if (!isVoiceContextValid(context)) return undefined;
    entry = await db.voiceEntries.get(id);
    if (!isVoiceContextValid(context)) return undefined;
  }
  return entry;
}

export async function requestVoiceDeletion(
  id: string,
  context = getDataContext(),
): Promise<VoiceSyncOutcome> {
  assertVoiceContext(context);
  const db = context.database;
  const entry = await db.voiceEntries.get(id);
  assertVoiceContext(context);
  if (!entry) return 'success';
  if (!entry.serverStored) {
    await db.voiceEntries.delete(id);
    assertVoiceContext(context);
    return 'success';
  }

  await db.voiceEntries.update(id, {
    audio: null,
    transcript: null,
    status: 'deleting',
    lastError: null,
    retryable: true,
    nextAttemptAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  assertVoiceContext(context);
  return deleteServerEntry(id, context);
}

async function performFlush(context: DataContext): Promise<VoiceSyncOutcome> {
  assertVoiceContext(context);
  const db = context.database;
  if (!browserOnline()) return 'offline';
  const entries = (await db.voiceEntries.orderBy('createdAt').toArray()).filter((entry) => {
    if (entry.status === 'deleting') return due(entry);
    return (
      (entry.status === 'queued' || entry.status === 'uploading' || entry.status === 'failed') &&
      entry.retryable &&
      due(entry)
    );
  });
  assertVoiceContext(context);

  for (const entry of entries) {
    if (entry.status === 'deleting') {
      const outcome = await deleteServerEntry(entry.id, context);
      if (outcome !== 'success') return outcome;
      continue;
    }
    const outcome = await uploadEntry(entry, context);
    if (outcome !== 'success') return outcome;
  }
  return 'success';
}

async function uploadEntry(
  entry: LocalVoiceEntry,
  context: DataContext,
): Promise<VoiceSyncOutcome> {
  assertVoiceContext(context);
  const db = context.database;
  if (!entry.audio) {
    await failUpload(entry, 'Локальная аудиозапись недоступна.', false, context);
    return 'success';
  }
  await db.voiceEntries.update(entry.id, {
    status: 'uploading',
    updatedAt: new Date().toISOString(),
  });
  assertVoiceContext(context);

  let response: Response;
  try {
    const workout = entry.workoutId ? `?workoutId=${encodeURIComponent(entry.workoutId)}` : '';
    response = await voiceRequest(
      `/api/v1/voice-entries/${entry.id}/audio${workout}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': entry.mimeType,
          'x-voice-consent-version': entry.consentVersion,
        },
        body: entry.audio,
      },
      context,
    );
  } catch {
    assertVoiceContext(context);
    await failUpload(entry, 'Нет связи с сервером. Повторим автоматически.', true, context);
    return browserOnline() ? 'retry' : 'offline';
  }

  if (response.status === 401) {
    await failUpload(
      entry,
      'Сессия истекла. Войди снова, запись останется на устройстве.',
      true,
      context,
    );
    assertVoiceContext(context);
    notifyUnauthorized();
    return 'unauthorized';
  }
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    await failUpload(
      entry,
      retryable
        ? 'Сервер временно недоступен. Повторим автоматически.'
        : 'Сервер не принял запись. Удали её и запиши снова.',
      retryable,
      context,
    );
    return retryable ? 'retry' : 'success';
  }

  const payload = (await response.json()) as { entry?: unknown };
  assertVoiceContext(context);
  const server = parseVoiceEntry(payload.entry);
  if (!server) {
    await failUpload(
      entry,
      'Сервер вернул некорректный статус. Повторим автоматически.',
      true,
      context,
    );
    return 'retry';
  }
  await db.voiceEntries.update(entry.id, {
    ...server,
    serverStored: true,
    retryable: false,
    nextAttemptAt: null,
    uploadAttempts: entry.uploadAttempts + 1,
  });
  assertVoiceContext(context);
  return 'success';
}

async function deleteServerEntry(id: string, context: DataContext): Promise<VoiceSyncOutcome> {
  assertVoiceContext(context);
  const db = context.database;
  if (!browserOnline()) return 'offline';
  let response: Response;
  try {
    response = await voiceRequest(
      `/api/v1/voice-entries/${id}`,
      {
        method: 'DELETE',
        credentials: 'same-origin',
      },
      context,
    );
  } catch {
    assertVoiceContext(context);
    await scheduleDeleteRetry(id, context);
    return browserOnline() ? 'retry' : 'offline';
  }
  if (response.status === 401) {
    await scheduleDeleteRetry(id, context);
    assertVoiceContext(context);
    notifyUnauthorized();
    return 'unauthorized';
  }
  if (response.ok || response.status === 404) {
    await db.voiceEntries.delete(id);
    assertVoiceContext(context);
    return 'success';
  }
  await scheduleDeleteRetry(id, context);
  return 'retry';
}

async function failUpload(
  entry: LocalVoiceEntry,
  lastError: string,
  retryable: boolean,
  context: DataContext,
) {
  assertVoiceContext(context);
  const db = context.database;
  const uploadAttempts = entry.uploadAttempts + 1;
  const delayMs = Math.min(2_000 * 2 ** Math.max(0, uploadAttempts - 1), 60_000);
  const now = new Date();
  await db.voiceEntries.update(entry.id, {
    status: 'failed',
    lastError,
    retryable,
    uploadAttempts,
    nextAttemptAt: retryable ? new Date(now.getTime() + delayMs).toISOString() : null,
    updatedAt: now.toISOString(),
  });
  assertVoiceContext(context);
  if (retryable) scheduleFlush(delayMs, context);
}

async function scheduleDeleteRetry(id: string, context: DataContext) {
  assertVoiceContext(context);
  const db = context.database;
  const now = new Date();
  await db.voiceEntries.update(id, {
    status: 'deleting',
    retryable: true,
    nextAttemptAt: new Date(now.getTime() + 5_000).toISOString(),
    updatedAt: now.toISOString(),
  });
  assertVoiceContext(context);
  scheduleFlush(5_000, context);
}

function scheduleFlush(delayMs: number, context: DataContext) {
  if (!isVoiceContextValid(context) || retryTimers.has(context)) return;
  const retryTimer = setTimeout(() => {
    retryTimers.delete(context);
    if (isVoiceContextValid(context)) void flushVoiceQueue(context);
  }, delayMs);
  retryTimers.set(context, retryTimer);
  if (typeof retryTimer === 'object' && 'unref' in retryTimer) retryTimer.unref();
}

function parseVoiceConfig(value: unknown): VoiceConfig | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.enabled !== 'boolean' ||
    typeof item.consentVersion !== 'string' ||
    typeof item.maximumBytes !== 'number' ||
    typeof item.maximumSeconds !== 'number' ||
    (typeof item.provider !== 'string' && item.provider !== null)
  ) {
    return null;
  }
  return item as VoiceConfig;
}

function parseVoiceEntry(value: unknown): VoiceEntryRecord | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string' ||
    (typeof item.workoutId !== 'string' && item.workoutId !== null) ||
    !['pending', 'processing', 'confirmed', 'failed'].includes(String(item.status)) ||
    (typeof item.transcript !== 'string' && item.transcript !== null) ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string' ||
    (typeof item.lastError !== 'string' && item.lastError !== null)
  ) {
    return null;
  }
  return item as VoiceEntryRecord;
}

function due(entry: LocalVoiceEntry) {
  return !entry.nextAttemptAt || entry.nextAttemptAt <= new Date().toISOString();
}

function voiceEntryIsInProgress(entry: LocalVoiceEntry) {
  return (
    entry.status === 'queued' ||
    entry.status === 'uploading' ||
    entry.status === 'pending' ||
    entry.status === 'processing'
  );
}

function waitForPoll(intervalMs: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve(true);
    }, intervalMs);
    const abort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function browserOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function notifyUnauthorized() {
  window.dispatchEvent(new Event('mighty-cringe:unauthorized'));
}
