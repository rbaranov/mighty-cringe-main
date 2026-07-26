import assert from 'node:assert/strict';
import { test } from 'node:test';

import postgres from 'postgres';

import { PostgresVoiceJobStore } from './voiceProcessor.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'PostgreSQL claims, retries, and confirms voice jobs atomically',
  { skip: !databaseUrl },
  async () => {
    const sql = postgres(databaseUrl!, { max: 1, prepare: false });
    const jobs = new PostgresVoiceJobStore(databaseUrl!);
    const userId = '84000000-0000-4000-8000-000000000001';
    const voiceId = '85000000-0000-4000-8000-000000000001';
    try {
      await sql`
        insert into users (id, email, display_name)
        values (${userId}, 'voice-worker-test@example.com', 'Voice Worker Test')
        on conflict (id) do nothing
      `;
      await sql`
        insert into voice_entries (
          id, user_id, object_key, mime_type, audio_format, size_bytes, consent_version
        ) values (
          ${voiceId}, ${userId}, 'worker-test/source.webm', 'audio/webm', 'webm', 3, '2026-07-22'
        )
        on conflict (id) do nothing
      `;

      const first = await jobs.claim();
      assert.equal(first?.id, voiceId);
      assert.equal(first?.language, 'ru');
      assert.equal(first?.attempts, 1);
      await jobs.fail(voiceId, 'temporary', new Date(Date.now() - 1_000));

      const second = await jobs.claim();
      assert.equal(second?.id, voiceId);
      assert.equal(second?.attempts, 2);
      await jobs.confirm(voiceId, 'жим лёжа 40 на 12');

      const rows = await sql<{ status: string; transcript: string }[]>`
        select status, transcript from voice_entries where id = ${voiceId}
      `;
      assert.deepEqual(rows[0], { status: 'confirmed', transcript: 'жим лёжа 40 на 12' });
    } finally {
      await jobs.close();
      await sql`delete from users where id = ${userId}`;
      await sql.end();
    }
  },
);
