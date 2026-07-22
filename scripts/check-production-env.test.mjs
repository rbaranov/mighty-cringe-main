import assert from 'node:assert/strict';
import test from 'node:test';

import { parseEnvironment, validateProductionEnvironment } from './check-production-env.mjs';

const core = {
  DOMAIN: 'mightycringe.com',
  WEB_ORIGIN: 'https://mightycringe.com',
  POSTGRES_DB: 'mightycringe',
  POSTGRES_USER: 'mightycringe',
  POSTGRES_PASSWORD: 'database-secret',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'oauth-secret',
};

const voice = {
  OPENROUTER_API_KEY: 'openrouter-secret',
  OPENROUTER_STT_MODEL: 'openai/whisper-large-v3',
  VOICE_S3_ENDPOINT: 'https://hel1.your-objectstorage.com',
  VOICE_S3_REGION: 'hel1',
  VOICE_S3_BUCKET: 'private-voice',
  VOICE_S3_ACCESS_KEY_ID: 'access-key',
  VOICE_S3_SECRET_ACCESS_KEY: 'storage-secret',
  VOICE_S3_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

test('accepts a core production environment with optional integrations disabled', () => {
  assert.deepEqual(validateProductionEnvironment(core), {
    backupEnabled: false,
    pushEnabled: false,
    voiceEnabled: false,
  });
});

test('accepts complete voice and VAPID groups', () => {
  assert.deepEqual(
    validateProductionEnvironment({
      ...core,
      ...voice,
      VAPID_SUBJECT: 'mailto:owner@mightycringe.com',
      VAPID_PUBLIC_KEY: 'public-key',
      VAPID_PRIVATE_KEY: 'private-key',
      S3_ENDPOINT: 'https://hel1.your-objectstorage.com',
      S3_REGION: 'hel1',
      S3_BUCKET: 'private-backups',
      S3_ACCESS_KEY: 'backup-access-key',
      S3_SECRET_KEY: 'backup-secret-key',
      RESTIC_PASSWORD: 'a'.repeat(32),
    }),
    { backupEnabled: true, pushEnabled: true, voiceEnabled: true },
  );
});

test('rejects partial optional groups without exposing configured values', () => {
  const environment = { ...core, OPENROUTER_API_KEY: 'do-not-print' };
  assert.throws(
    () => validateProductionEnvironment(environment),
    (error) =>
      error instanceof Error &&
      /OPENROUTER_STT_MODEL/u.test(error.message) &&
      !error.message.includes(environment.OPENROUTER_API_KEY),
  );

  assert.throws(
    () => validateProductionEnvironment({ ...core, VAPID_PUBLIC_KEY: 'do-not-print' }),
    /VAPID_SUBJECT, VAPID_PRIVATE_KEY/u,
  );

  assert.throws(
    () => validateProductionEnvironment({ ...core, S3_ACCESS_KEY: 'do-not-print' }),
    /S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_SECRET_KEY, RESTIC_PASSWORD/u,
  );
});

test('validates complete encrypted backup settings', () => {
  const backup = {
    S3_ENDPOINT: 'https://hel1.your-objectstorage.com',
    S3_REGION: 'hel1',
    S3_BUCKET: 'private-backups',
    S3_ACCESS_KEY: 'backup-access-key',
    S3_SECRET_KEY: 'backup-secret-key',
    RESTIC_PASSWORD: 'a'.repeat(32),
    BACKUP_KEEP_DAILY: '14',
    BACKUP_KEEP_WEEKLY: '8',
    BACKUP_KEEP_MONTHLY: '12',
    RESTIC_CHECK_SUBSET: '5%',
  };
  assert.equal(validateProductionEnvironment({ ...core, ...backup }).backupEnabled, true);
  assert.throws(
    () => validateProductionEnvironment({ ...core, ...backup, RESTIC_PASSWORD: 'short' }),
    /at least 32 characters/u,
  );
  assert.throws(
    () => validateProductionEnvironment({ ...core, ...backup, RESTIC_CHECK_SUBSET: '0%' }),
    /from 1% to 100%/u,
  );
});

test('requires voice storage and transcription to be enabled together', () => {
  const { OPENROUTER_API_KEY, OPENROUTER_STT_MODEL, ...storageOnly } = voice;
  assert.throws(
    () => validateProductionEnvironment({ ...core, ...storageOnly }),
    /must be configured together/u,
  );
});

test('validates the voice encryption key without printing it', () => {
  const environment = { ...core, ...voice, VOICE_S3_ENCRYPTION_KEY: 'do-not-print' };
  assert.throws(
    () => validateProductionEnvironment(environment),
    (error) =>
      error instanceof Error &&
      /exactly 32 bytes/u.test(error.message) &&
      !error.message.includes(environment.VOICE_S3_ENCRYPTION_KEY),
  );
});

test('parses quoted values, equals signs and comments', () => {
  assert.deepEqual(
    parseEnvironment(`
# comment
export DOMAIN=mightycringe.com
GOOGLE_CLIENT_SECRET="secret=with=equals"
POSTGRES_PASSWORD=value # explanation
EMPTY=
`),
    {
      DOMAIN: 'mightycringe.com',
      GOOGLE_CLIENT_SECRET: 'secret=with=equals',
      POSTGRES_PASSWORD: 'value',
      EMPTY: '',
    },
  );
});
