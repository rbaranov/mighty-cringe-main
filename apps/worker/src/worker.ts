import 'dotenv/config';

const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 15_000);

function log(event: string, attributes: Record<string, unknown> = {}) {
  process.stdout.write(`${JSON.stringify({ level: 'info', event, ...attributes })}\n`);
}

async function tick() {
  // Voice parsing, notification delivery, and recovery retries are intentionally centralized here.
  // Each task will claim work transactionally and remains idempotent when a worker restarts.
  log('worker.tick');
}

log('worker.started', { intervalMs });
await tick();
setInterval(() => void tick(), intervalMs);
