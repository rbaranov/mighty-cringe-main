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
    }),
    { pushEnabled: true, voiceEnabled: true },
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
