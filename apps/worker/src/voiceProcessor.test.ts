import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VoiceProviderError, type VoiceStorage, type VoiceTranscriber } from '@mighty-cringe/voice';

import { VoiceProcessor, type VoiceJob, type VoiceJobStore } from './voiceProcessor.js';

class MemoryJobs implements VoiceJobStore {
  claimed: VoiceJob | null = {
    id: '81000000-0000-4000-8000-000000000001',
    objectKey: 'user/voice/source.webm',
    audioFormat: 'webm',
    attempts: 1,
  };
  confirmed: { id: string; transcript: string } | null = null;
  failure: { id: string; message: string; retryAt: Date | null } | null = null;

  async claim() {
    const job = this.claimed;
    this.claimed = null;
    return job;
  }

  async confirm(id: string, transcript: string) {
    this.confirmed = { id, transcript };
  }

  async fail(id: string, message: string, retryAt: Date | null) {
    this.failure = { id, message, retryAt };
  }

  async close() {}
}

const storage: VoiceStorage = {
  async put() {},
  async get() {
    return Uint8Array.from([1, 2, 3]);
  },
  async delete() {},
};

test('confirms a transcript after reading private audio', async () => {
  const jobs = new MemoryJobs();
  const transcriber: VoiceTranscriber = {
    async transcribe({ audio, format }) {
      assert.deepEqual([...audio], [1, 2, 3]);
      assert.equal(format, 'webm');
      return 'жим лёжа 40 на 12';
    },
  };

  const result = await new VoiceProcessor(jobs, storage, transcriber).processOne();
  assert.equal(result?.status, 'confirmed');
  assert.deepEqual(jobs.confirmed, {
    id: '81000000-0000-4000-8000-000000000001',
    transcript: 'жим лёжа 40 на 12',
  });
});

test('schedules transient failures with exponential backoff', async () => {
  const jobs = new MemoryJobs();
  const transcriber: VoiceTranscriber = {
    async transcribe() {
      throw new VoiceProviderError('rate limited', true);
    },
  };

  const result = await new VoiceProcessor(
    jobs,
    storage,
    transcriber,
    () => new Date('2026-07-22T00:00:00.000Z'),
  ).processOne();
  assert.equal(result?.status, 'pending');
  assert.equal(jobs.failure?.retryAt?.toISOString(), '2026-07-22T00:00:30.000Z');
});

test('does not retry permanent provider failures', async () => {
  const jobs = new MemoryJobs();
  const transcriber: VoiceTranscriber = {
    async transcribe() {
      throw new VoiceProviderError('unsupported recording', false);
    },
  };

  const result = await new VoiceProcessor(jobs, storage, transcriber).processOne();
  assert.equal(result?.status, 'failed');
  assert.equal(jobs.failure?.retryAt, null);
});
