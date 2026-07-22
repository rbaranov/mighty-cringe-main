import 'dotenv/config';

import { buildApp } from './app.js';
import { authOptionsFromEnvironment, localDemoIdentityFromEnvironment } from './auth.js';
import { MemoryRepository, PostgresRepository } from './repository.js';
import { voiceStorageFromEnvironment, voiceTranscriberFromEnvironment } from '@mighty-cringe/voice';
import { pushPublicKeyFromEnvironment } from '@mighty-cringe/push';
import { exerciseDiscoveryFromEnvironment } from './exerciseDiscovery.js';

const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;
const voiceProcessingEnabled = Boolean(voiceTranscriberFromEnvironment(process.env));
const repository = databaseUrl ? new PostgresRepository(databaseUrl) : new MemoryRepository();

if (repository instanceof PostgresRepository) await repository.initialize();

const auth = authOptionsFromEnvironment();
const localDemoIdentity = auth ? undefined : localDemoIdentityFromEnvironment();
const developmentUser = localDemoIdentity
  ? await repository.upsertGoogleUser(localDemoIdentity, 'athlete')
  : undefined;

const app = buildApp(repository, {
  auth,
  developmentUser,
  voiceStorage: voiceStorageFromEnvironment(process.env),
  voiceProcessingEnabled,
  pushPublicKey: pushPublicKeyFromEnvironment(process.env),
  exerciseDiscovery: exerciseDiscoveryFromEnvironment(process.env) ?? undefined,
});

await app.listen({ host: '0.0.0.0', port });
