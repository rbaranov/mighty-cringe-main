import 'dotenv/config';

import { voiceStorageFromEnvironment, voiceTranscriberFromEnvironment } from '@mighty-cringe/voice';

import { PostgresVoiceJobStore, VoiceProcessor } from './voiceProcessor.js';

const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 15_000);
const databaseUrl = process.env.DATABASE_URL?.trim();
const storage = voiceStorageFromEnvironment(process.env);
const transcriber = voiceTranscriberFromEnvironment(process.env);
const jobs = databaseUrl ? new PostgresVoiceJobStore(databaseUrl) : undefined;
const processor =
  jobs && storage && transcriber ? new VoiceProcessor(jobs, storage, transcriber) : null;

function log(event: string, attributes: Record<string, unknown> = {}) {
  process.stdout.write(`${JSON.stringify({ level: 'info', event, ...attributes })}\n`);
}

let running = false;
async function tick() {
  if (!processor || running) return;
  running = true;
  try {
    let processed = 0;
    while (processed < 10) {
      const result = await processor.processOne();
      if (!result) break;
      processed += 1;
      log('worker.voice.processed', result);
    }
  } catch (error) {
    log('worker.voice.tick_failed', {
      message: error instanceof Error ? error.message : 'Unknown worker error',
    });
  } finally {
    running = false;
  }
}

if (!processor) {
  log('worker.voice.disabled', {
    databaseConfigured: Boolean(databaseUrl),
    storageConfigured: Boolean(storage),
    transcriberConfigured: Boolean(transcriber),
  });
  setInterval(() => undefined, intervalMs);
} else {
  log('worker.started', { intervalMs });
  await tick();
  setInterval(() => void tick(), intervalMs);
}
