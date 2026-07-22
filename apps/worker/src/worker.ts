import 'dotenv/config';

import { voiceStorageFromEnvironment, voiceTranscriberFromEnvironment } from '@mighty-cringe/voice';
import { pushSenderFromEnvironment } from '@mighty-cringe/push';

import { PostgresVoiceJobStore, VoiceProcessor } from './voiceProcessor.js';
import { NotificationProcessor, PostgresNotificationJobStore } from './notificationProcessor.js';

const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 15_000);
const databaseUrl = process.env.DATABASE_URL?.trim();
const storage = voiceStorageFromEnvironment(process.env);
const transcriber = voiceTranscriberFromEnvironment(process.env);
const jobs = databaseUrl ? new PostgresVoiceJobStore(databaseUrl) : undefined;
const processor =
  jobs && storage && transcriber ? new VoiceProcessor(jobs, storage, transcriber) : null;
const pushSender = pushSenderFromEnvironment(process.env);
const notificationJobs =
  databaseUrl && pushSender ? new PostgresNotificationJobStore(databaseUrl) : undefined;
const notificationProcessor =
  notificationJobs && pushSender ? new NotificationProcessor(notificationJobs, pushSender) : null;

function log(event: string, attributes: Record<string, unknown> = {}) {
  process.stdout.write(`${JSON.stringify({ level: 'info', event, ...attributes })}\n`);
}

let running = false;
async function tick() {
  if ((!processor && !notificationProcessor) || running) return;
  running = true;
  try {
    if (processor) {
      let processed = 0;
      while (processed < 10) {
        const result = await processor.processOne();
        if (!result) break;
        processed += 1;
        log('worker.voice.processed', result);
      }
    }
    if (notificationProcessor) {
      const scheduled = await notificationProcessor.scheduleDue();
      if (scheduled) log('worker.notification.scheduled', { count: scheduled });
      let processed = 0;
      while (processed < 10) {
        const result = await notificationProcessor.processOne();
        if (!result) break;
        processed += 1;
        log('worker.notification.processed', result);
      }
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
}
if (!notificationProcessor) {
  log('worker.notification.disabled', {
    databaseConfigured: Boolean(databaseUrl),
    vapidConfigured: Boolean(pushSender),
  });
}

if (!processor && !notificationProcessor) {
  setInterval(() => undefined, intervalMs);
} else {
  log('worker.started', {
    intervalMs,
    voiceEnabled: Boolean(processor),
    notificationEnabled: Boolean(notificationProcessor),
  });
  await tick();
  setInterval(() => void tick(), intervalMs);
}
