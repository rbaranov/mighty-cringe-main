import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  OpenRouterTranscriber,
  VoiceProviderError,
  voiceStorageFromEnvironment,
  voiceTranscriberFromEnvironment,
} from './index.js';

test('requests transcription with raw base64 audio and zero-data-retention routing', async () => {
  let body: Record<string, unknown> | undefined;
  const request: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ text: ' жим лёжа 40 на 12 ' });
  };
  const transcriber = new OpenRouterTranscriber(
    'server-secret',
    'openai/whisper-large-v3',
    request,
  );

  const transcript = await transcriber.transcribe({
    audio: Uint8Array.from([1, 2, 3]),
    format: 'webm',
  });

  assert.equal(transcript, 'жим лёжа 40 на 12');
  assert.deepEqual(body, {
    model: 'openai/whisper-large-v3',
    input_audio: { data: 'AQID', format: 'webm' },
    provider: { zdr: true },
  });
});

test('marks rate limits as retryable provider failures', async () => {
  const request: typeof fetch = async () => new Response(null, { status: 429 });
  const transcriber = new OpenRouterTranscriber('server-secret', 'model', request);

  await assert.rejects(
    () => transcriber.transcribe({ audio: Uint8Array.from([1]), format: 'wav' }),
    (error) => error instanceof VoiceProviderError && error.retryable,
  );
});

test('does not enable private storage without a valid 32-byte SSE-C key', () => {
  const environment = {
    VOICE_S3_ENDPOINT: 'https://hel1.your-objectstorage.com',
    VOICE_S3_REGION: 'hel1',
    VOICE_S3_BUCKET: 'private-voice',
    VOICE_S3_ACCESS_KEY_ID: 'access',
    VOICE_S3_SECRET_ACCESS_KEY: 'secret',
  };

  assert.throws(() => voiceStorageFromEnvironment(environment), /configuration is incomplete/);
  assert.ok(
    voiceStorageFromEnvironment({
      ...environment,
      VOICE_S3_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    }),
  );
});

test('keeps voice disabled when the shared OpenRouter key is used only for exercise discovery', () => {
  assert.equal(
    voiceTranscriberFromEnvironment({
      OPENROUTER_API_KEY: 'server-secret',
      EXERCISE_DISCOVERY_MODEL: 'openai/gpt-4.1-mini',
    }),
    undefined,
  );
});

test('rejects an STT model without the shared OpenRouter key', () => {
  assert.throws(
    () =>
      voiceTranscriberFromEnvironment({
        OPENROUTER_STT_MODEL: 'openai/whisper-large-v3',
      }),
    /configuration is incomplete/,
  );
});
