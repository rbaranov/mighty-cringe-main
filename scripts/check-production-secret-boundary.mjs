import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseEnvironment } from './check-production-env.mjs';

// The password also appears in DATABASE_URL, so inspect rendered values, not only key names.
const secretRecipients = {
  POSTGRES_PASSWORD: ['api', 'worker', 'postgres', 'migrate', 'backup', 'restore-postgres'],
  GOOGLE_CLIENT_SECRET: ['api'],
  OPENROUTER_API_KEY: ['api', 'worker'],
  VOICE_S3_ACCESS_KEY_ID: ['api', 'worker'],
  VOICE_S3_SECRET_ACCESS_KEY: ['api', 'worker'],
  VOICE_S3_ENCRYPTION_KEY: ['api', 'worker'],
  VAPID_PRIVATE_KEY: ['worker'],
  S3_ACCESS_KEY: ['backup'],
  S3_SECRET_KEY: ['backup'],
  RESTIC_PASSWORD: ['backup'],
  HEALTHCHECKS_PING_URL: [],
  UNRELATED_SERVICE_SECRET: [],
};

export function assertProductionSecretBoundary(compose, fixture) {
  for (const [key, recipients] of Object.entries(secretRecipients)) {
    const actualRecipients = Object.entries(compose.services)
      .filter(([, service]) => JSON.stringify(service).includes(fixture[key]))
      .map(([name]) => name)
      .sort();
    assert.deepEqual(actualRecipients, [...recipients].sort(), `${key} recipients changed`);
  }

  // These non-secret values were previously inherited from env_file. Exercise their custom
  // values as well, so tightening the boundary cannot silently reset auth or runtime settings.
  for (const key of [
    'PORT',
    'WEB_ORIGIN',
    'GOOGLE_CLIENT_ID',
    'ADMIN_EMAILS',
    'TRAINER_EMAILS',
    'SESSION_TTL_DAYS',
    'EXERCISE_DISCOVERY_MODEL',
  ]) {
    assert.equal(
      compose.services.api.environment[key],
      fixture[key],
      `${key} was not passed to API`,
    );
  }
  assert.equal(compose.services.caddy.environment.DOMAIN, fixture.DOMAIN);
  assert.equal(compose.services.worker.environment.WORKER_INTERVAL_MS, fixture.WORKER_INTERVAL_MS);
}

async function main() {
  const productionDirectory = fileURLToPath(new URL('../infra/production/', import.meta.url));
  const template = parseEnvironment(
    await readFile(join(productionDirectory, '.env.example'), 'utf8'),
  );
  const fixture = Object.fromEntries(
    Object.keys({ ...template, UNRELATED_SERVICE_SECRET: '' }).map((key) => [
      key,
      `boundary-fixture-${key.toLowerCase().replaceAll('_', '-')}`,
    ]),
  );
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'mighty-cringe-secret-boundary-'));
  try {
    const environmentPath = join(temporaryDirectory, 'fixture.env');
    await writeFile(
      environmentPath,
      Object.entries(fixture)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
      { mode: 0o600 },
    );
    const result = spawnSync(
      'docker',
      [
        'compose',
        '--env-file',
        environmentPath,
        '--profile',
        'backup',
        'config',
        '--format',
        'json',
      ],
      {
        cwd: productionDirectory,
        env: { ...process.env, ...fixture, PRODUCTION_ENV_FILE: environmentPath },
        encoding: 'utf8',
      },
    );
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'Docker Compose could not render the synthetic configuration');
    assertProductionSecretBoundary(JSON.parse(result.stdout), fixture);
    console.log('Production service secret boundaries and custom runtime settings passed');
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Production secret boundary check failed',
    );
    process.exitCode = 1;
  });
}
