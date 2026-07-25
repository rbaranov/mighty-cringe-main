import type { VoiceEntryRecord } from '@mighty-cringe/contracts';

import { db, type LocalVoiceEntry } from './db';

export type VoiceConfig = {
  enabled: boolean;
  consentVersion: string;
  maximumBytes: number;
  maximumSeconds: number;
  provider: string | null;
};

export type VoiceSyncOutcome = 'success' | 'offline' | 'retry' | 'unauthorized';

const voiceConsentMetaKey = 'voiceConsentVersion';

let activeFlush: Promise<VoiceSyncOutcome> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export async function loadVoiceConfig(): Promise<VoiceConfig | null> {
  if (browserOnline()) {
    try {
      const response = await fetch('/api/v1/voice/config', { credentials: 'same-origin' });
      if (response.status === 401) {
        notifyUnauthorized();
        return null;
      }
      if (response.ok) {
        const config = parseVoiceConfig(await response.json());
        if (config) {
          await db.meta.put({ key: 'voiceConfig', value: JSON.stringify(config) });
          return config;
        }
      }
    } catch {
      // A previously authenticated device may continue recording into its private local queue.
    }
  }

  const cached = await db.meta.get('voiceConfig');
  if (!cached) return null;
  try {
    return parseVoiceConfig(JSON.parse(cached.value));
  } catch {
    return null;
  }
}

export async function hasAcceptedVoiceConsent(version: string) {
  return (await db.meta.get(voiceConsentMetaKey))?.value === version;
}

export async function acceptVoiceConsent(version: string) {
  await db.meta.put({ key: voiceConsentMetaKey, value: version });
}

export async function revokeVoiceConsent() {
  await db.meta.delete(voiceConsentMetaKey);
}

export async function queueVoiceRecording(input: {
  workoutId: string | null;
  audio: Blob;
  consentVersion: string;
  id?: string;
  now?: Date;
}) {
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
  await db.voiceEntries.put(entry);
  return entry;
}

export function flushVoiceQueue() {
  if (activeFlush) return activeFlush;
  activeFlush = performFlush().finally(() => {
    activeFlush = null;
  });
  return activeFlush;
}

export async function refreshVoiceEntries(): Promise<VoiceSyncOutcome> {
  if (!browserOnline()) return 'offline';
  let response: Response;
  try {
    response = await fetch('/api/v1/voice-entries', { credentials: 'same-origin' });
  } catch {
    return 'retry';
  }
  if (response.status === 401) {
    notifyUnauthorized();
    return 'unauthorized';
  }
  if (!response.ok) return 'retry';

  const payload = (await response.json()) as { items?: unknown };
  if (!Array.isArray(payload.items)) return 'retry';
  const records = payload.items.map(parseVoiceEntry).filter(Boolean) as VoiceEntryRecord[];
  await db.transaction('rw', db.voiceEntries, async () => {
    for (const record of records) {
      const local = await db.voiceEntries.get(record.id);
      if (local?.status === 'deleting') continue;
      await db.voiceEntries.put({
        ...record,
        audio: local?.audio ?? null,
        mimeType: local?.mimeType ?? '',
        consentVersion: local?.consentVersion ?? '',
        serverStored: true,
        uploadAttempts: local?.uploadAttempts ?? 0,
        retryable: false,
        nextAttemptAt: null,
      });
    }
  });
  return 'success';
}

export async function requestVoiceDeletion(id: string): Promise<VoiceSyncOutcome> {
  const entry = await db.voiceEntries.get(id);
  if (!entry) return 'success';
  if (!entry.serverStored) {
    await db.voiceEntries.delete(id);
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
  return deleteServerEntry(id);
}

async function performFlush(): Promise<VoiceSyncOutcome> {
  if (!browserOnline()) return 'offline';
  const entries = (await db.voiceEntries.orderBy('createdAt').toArray()).filter((entry) => {
    if (entry.status === 'deleting') return due(entry);
    return (
      (entry.status === 'queued' || entry.status === 'uploading' || entry.status === 'failed') &&
      entry.retryable &&
      due(entry)
    );
  });

  for (const entry of entries) {
    if (entry.status === 'deleting') {
      const outcome = await deleteServerEntry(entry.id);
      if (outcome !== 'success') return outcome;
      continue;
    }
    const outcome = await uploadEntry(entry);
    if (outcome !== 'success') return outcome;
  }
  return 'success';
}

async function uploadEntry(entry: LocalVoiceEntry): Promise<VoiceSyncOutcome> {
  if (!entry.audio) {
    await failUpload(entry, 'Локальная аудиозапись недоступна.', false);
    return 'success';
  }
  await db.voiceEntries.update(entry.id, {
    status: 'uploading',
    updatedAt: new Date().toISOString(),
  });

  let response: Response;
  try {
    const workout = entry.workoutId ? `?workoutId=${encodeURIComponent(entry.workoutId)}` : '';
    response = await fetch(`/api/v1/voice-entries/${entry.id}/audio${workout}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': entry.mimeType,
        'x-voice-consent-version': entry.consentVersion,
      },
      body: entry.audio,
    });
  } catch {
    await failUpload(entry, 'Нет связи с сервером. Повторим автоматически.', true);
    return browserOnline() ? 'retry' : 'offline';
  }

  if (response.status === 401) {
    await failUpload(entry, 'Сессия истекла. Войди снова, запись останется на устройстве.', true);
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
    );
    return retryable ? 'retry' : 'success';
  }

  const payload = (await response.json()) as { entry?: unknown };
  const server = parseVoiceEntry(payload.entry);
  if (!server) {
    await failUpload(entry, 'Сервер вернул некорректный статус. Повторим автоматически.', true);
    return 'retry';
  }
  await db.voiceEntries.update(entry.id, {
    ...server,
    serverStored: true,
    retryable: false,
    nextAttemptAt: null,
    uploadAttempts: entry.uploadAttempts + 1,
  });
  return 'success';
}

async function deleteServerEntry(id: string): Promise<VoiceSyncOutcome> {
  if (!browserOnline()) return 'offline';
  let response: Response;
  try {
    response = await fetch(`/api/v1/voice-entries/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
  } catch {
    await scheduleDeleteRetry(id);
    return browserOnline() ? 'retry' : 'offline';
  }
  if (response.status === 401) {
    await scheduleDeleteRetry(id);
    notifyUnauthorized();
    return 'unauthorized';
  }
  if (response.ok || response.status === 404) {
    await db.voiceEntries.delete(id);
    return 'success';
  }
  await scheduleDeleteRetry(id);
  return 'retry';
}

async function failUpload(entry: LocalVoiceEntry, lastError: string, retryable: boolean) {
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
  if (retryable) scheduleFlush(delayMs);
}

async function scheduleDeleteRetry(id: string) {
  const now = new Date();
  await db.voiceEntries.update(id, {
    status: 'deleting',
    retryable: true,
    nextAttemptAt: new Date(now.getTime() + 5_000).toISOString(),
    updatedAt: now.toISOString(),
  });
  scheduleFlush(5_000);
}

function scheduleFlush(delayMs: number) {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushVoiceQueue();
  }, delayMs);
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

function browserOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function notifyUnauthorized() {
  window.dispatchEvent(new Event('mighty-cringe:unauthorized'));
}
