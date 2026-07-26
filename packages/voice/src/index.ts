import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export const voiceConsentVersion = '2026-07-22';
export const maximumVoiceBytes = 10 * 1024 * 1024;
export const maximumVoiceDurationSeconds = 60;

export type AudioFormat = 'aac' | 'flac' | 'm4a' | 'mp3' | 'ogg' | 'wav' | 'webm';
export type TranscriptionLanguage = 'ru' | 'en';

export interface VoiceStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

export interface VoiceTranscriber {
  transcribe(input: {
    audio: Uint8Array;
    format: AudioFormat;
    language: TranscriptionLanguage;
  }): Promise<string>;
}

export class S3VoiceStorage implements VoiceStorage {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    private readonly encryptionKey: string,
    options: {
      endpoint: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle?: boolean;
    },
  ) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? false,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        SSECustomerAlgorithm: 'AES256',
        SSECustomerKey: this.encryptionKey,
      }),
    );
  }

  async get(key: string) {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        SSECustomerAlgorithm: 'AES256',
        SSECustomerKey: this.encryptionKey,
      }),
    );
    if (!result.Body) throw new Error('Voice object has no body');
    return result.Body.transformToByteArray();
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export class OpenRouterTranscriber implements VoiceTranscriber {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  async transcribe({
    audio,
    format,
    language,
  }: {
    audio: Uint8Array;
    format: AudioFormat;
    language: TranscriptionLanguage;
  }) {
    let response: Response;
    try {
      response = await this.request('https://openrouter.ai/api/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          'x-title': 'MightyCringe',
        },
        body: JSON.stringify({
          model: this.model,
          input_audio: { data: Buffer.from(audio).toString('base64'), format },
          language,
          provider: { zdr: true },
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new VoiceProviderError('OpenRouter transcription request failed', true, {
        cause: error,
      });
    }

    if (!response.ok) {
      const retryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      throw new VoiceProviderError(
        `OpenRouter transcription failed with ${response.status}`,
        retryable,
      );
    }
    const payload = (await response.json()) as { text?: unknown };
    if (typeof payload.text !== 'string' || !payload.text.trim()) {
      throw new VoiceProviderError('OpenRouter returned an empty transcript', true);
    }
    return payload.text.trim();
  }
}

export class VoiceProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function voiceStorageFromEnvironment(
  environment: Record<string, string | undefined>,
): VoiceStorage | undefined {
  const endpoint = environment.VOICE_S3_ENDPOINT?.trim();
  const region = environment.VOICE_S3_REGION?.trim();
  const bucket = environment.VOICE_S3_BUCKET?.trim();
  const accessKeyId = environment.VOICE_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = environment.VOICE_S3_SECRET_ACCESS_KEY?.trim();
  const encryptionKey = environment.VOICE_S3_ENCRYPTION_KEY?.trim();
  const configured = [endpoint, region, bucket, accessKeyId, secretAccessKey, encryptionKey].filter(
    Boolean,
  ).length;
  if (configured === 0) return undefined;
  if (
    !endpoint ||
    !region ||
    !bucket ||
    !accessKeyId ||
    !secretAccessKey ||
    !validEncryptionKey(encryptionKey)
  ) {
    throw new Error(
      'Voice storage configuration is incomplete or VOICE_S3_ENCRYPTION_KEY is not 32-byte base64',
    );
  }
  return new S3VoiceStorage(bucket, encryptionKey, {
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: environment.VOICE_S3_FORCE_PATH_STYLE === 'true',
  });
}

function validEncryptionKey(value: string | undefined): value is string {
  if (!value || !/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/.test(value)) return false;
  return Buffer.from(value, 'base64').length === 32;
}

export function voiceTranscriberFromEnvironment(
  environment: Record<string, string | undefined>,
): VoiceTranscriber | undefined {
  const apiKey = environment.OPENROUTER_API_KEY?.trim();
  const model = environment.OPENROUTER_STT_MODEL?.trim();
  // The server-only OpenRouter key is shared with exercise discovery. Voice stays disabled until
  // its own model is selected, while a selected STT model must never run without the shared key.
  if (!model) return undefined;
  if (!apiKey) throw new Error('OpenRouter voice configuration is incomplete');
  return new OpenRouterTranscriber(apiKey, model);
}

export function audioFormatFromMimeType(mimeType: string): AudioFormat | null {
  const normalized = mimeType.split(';', 1)[0].trim().toLowerCase();
  const formats: Record<string, AudioFormat> = {
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/x-m4a': 'm4a',
  };
  return formats[normalized] ?? null;
}
