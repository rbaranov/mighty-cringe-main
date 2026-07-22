import 'dotenv/config';

import { buildApp } from './app.js';
import { authOptionsFromEnvironment } from './auth.js';
import { MemoryRepository, PostgresRepository } from './repository.js';
import { voiceStorageFromEnvironment, voiceTranscriberFromEnvironment } from '@mighty-cringe/voice';

const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;
const voiceProcessingEnabled = Boolean(voiceTranscriberFromEnvironment(process.env));
const repository = databaseUrl ? new PostgresRepository(databaseUrl) : new MemoryRepository();

if (repository instanceof PostgresRepository) await repository.initialize();

const app = buildApp(repository, {
  auth: authOptionsFromEnvironment(),
  voiceStorage: voiceStorageFromEnvironment(process.env),
  voiceProcessingEnabled,
});

await app.listen({ host: '0.0.0.0', port });
