import postgres, { type Sql } from 'postgres';

import {
  isLikelyNonSpeechTranscript,
  VoiceProviderError,
  type AudioFormat,
  type TranscriptionLanguage,
  type VoiceStorage,
  type VoiceTranscriber,
} from '@mighty-cringe/voice';

const maximumAttempts = 5;

export type VoiceJob = {
  id: string;
  objectKey: string;
  audioFormat: AudioFormat;
  language: TranscriptionLanguage;
  attempts: number;
};

export interface VoiceJobStore {
  claim(): Promise<VoiceJob | null>;
  confirm(id: string, transcript: string): Promise<void>;
  fail(id: string, message: string, retryAt: Date | null): Promise<void>;
  close(): Promise<void>;
}

export class PostgresVoiceJobStore implements VoiceJobStore {
  private readonly sql: Sql;

  constructor(connectionString: string) {
    this.sql = postgres(connectionString, { max: 2, prepare: false });
  }

  async claim() {
    const rows = await this.sql<VoiceJob[]>`
      with candidate as (
        select
          entry.id,
          case when users.locale = 'en' then 'en' else 'ru' end as language
        from voice_entries as entry
        join users on users.id = entry.user_id
        where
          (entry.status = 'pending' and (
            entry.next_attempt_at is null or entry.next_attempt_at <= now()
          ))
          or (
            entry.status = 'processing'
            and entry.updated_at <= now() - interval '10 minutes'
          )
        order by coalesce(entry.next_attempt_at, entry.created_at), entry.created_at
        for update of entry skip locked
        limit 1
      )
      update voice_entries as voice
      set
        status = 'processing',
        attempts = voice.attempts + 1,
        next_attempt_at = null,
        last_error = null,
        updated_at = now()
      from candidate
      where voice.id = candidate.id
      returning
        voice.id,
        voice.object_key as "objectKey",
        voice.audio_format as "audioFormat",
        candidate.language,
        voice.attempts
    `;
    return rows[0] ?? null;
  }

  async confirm(id: string, transcript: string) {
    await this.sql`
      update voice_entries
      set
        status = 'confirmed',
        transcript = ${transcript},
        next_attempt_at = null,
        last_error = null,
        updated_at = now()
      where id = ${id} and status = 'processing'
    `;
  }

  async fail(id: string, message: string, retryAt: Date | null) {
    await this.sql`
      update voice_entries
      set
        status = ${retryAt ? 'pending' : 'failed'},
        next_attempt_at = ${retryAt},
        last_error = ${message.slice(0, 2_000)},
        updated_at = now()
      where id = ${id} and status = 'processing'
    `;
  }

  async close() {
    await this.sql.end();
  }
}

export class VoiceProcessor {
  constructor(
    private readonly jobs: VoiceJobStore,
    private readonly storage: VoiceStorage,
    private readonly transcriber: VoiceTranscriber,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async processOne() {
    const job = await this.jobs.claim();
    if (!job) return null;

    try {
      const audio = await this.storage.get(job.objectKey);
      const transcript = await this.transcriber.transcribe({
        audio,
        format: job.audioFormat,
        language: job.language,
      });
      if (isLikelyNonSpeechTranscript(transcript)) {
        throw new VoiceProviderError('No speech command detected', false);
      }
      await this.jobs.confirm(job.id, transcript);
      return { id: job.id, status: 'confirmed' as const, attempts: job.attempts };
    } catch (error) {
      const retryable = !(error instanceof VoiceProviderError) || error.retryable;
      const retryAt =
        retryable && job.attempts < maximumAttempts ? this.retryAt(job.attempts) : null;
      const message = error instanceof Error ? error.message : 'Unknown voice processing error';
      await this.jobs.fail(job.id, message, retryAt);
      return {
        id: job.id,
        status: retryAt ? ('pending' as const) : ('failed' as const),
        attempts: job.attempts,
      };
    }
  }

  private retryAt(attempt: number) {
    const delayMs = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 60 * 60_000);
    return new Date(this.now().getTime() + delayMs);
  }
}
