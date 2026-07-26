import { buildApp } from '../apps/api/dist/app.js';
import { MemoryRepository } from '../apps/api/dist/repository.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('The local voice acceptance server cannot run in production');
}

class MemoryVoiceStorage {
  objects = new Map();

  async put(key, body, contentType) {
    this.objects.set(key, { body, contentType });
  }

  async get(key) {
    const object = this.objects.get(key);
    if (!object) throw new Error('Voice object not found');
    return object.body;
  }

  async delete(key) {
    this.objects.delete(key);
  }
}

class AcceptanceRepository extends MemoryRepository {
  readyAt = new Map();

  async createVoiceEntry(userId, input) {
    const entry = await super.createVoiceEntry(userId, input);
    this.readyAt.set(entry.id, Date.now() + 1_200);
    return entry;
  }

  async listVoiceEntries(userId) {
    return (await super.listVoiceEntries(userId)).map((entry) =>
      Date.now() >= (this.readyAt.get(entry.id) ?? Number.POSITIVE_INFINITY)
        ? {
            ...entry,
            status: 'confirmed',
            transcript: 'жим штанги лежа 40 на 10 rir 2',
            updatedAt: new Date().toISOString(),
            lastError: null,
          }
        : entry,
    );
  }

  async deleteVoiceEntry(userId, voiceEntryId) {
    const deleted = await super.deleteVoiceEntry(userId, voiceEntryId);
    if (deleted) this.readyAt.delete(voiceEntryId);
    return deleted;
  }
}

const repository = new AcceptanceRepository();
const developmentUser = await repository.upsertGoogleUser(
  {
    subject: 'voice-acceptance-athlete',
    email: 'voice-acceptance@mightycringe.test',
    displayName: 'Voice Acceptance',
    avatarUrl: null,
  },
  'athlete',
);
const app = buildApp(repository, {
  developmentUser,
  voiceStorage: new MemoryVoiceStorage(),
  voiceProcessingEnabled: true,
  voiceProvider: 'локальный acceptance-сервер без внешней отправки',
});

await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
