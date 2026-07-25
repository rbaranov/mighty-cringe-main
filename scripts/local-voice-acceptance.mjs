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

const repository = new MemoryRepository();
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
