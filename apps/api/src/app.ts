import cors from '@fastify/cors';
import { createSetSchema, createWorkoutSchema, syncMutationSchema } from '@mighty-cringe/contracts';
import Fastify, { type FastifyBaseLogger } from 'fastify';

import type { WorkoutRepository } from './repository.js';

const developmentUserId = '00000000-0000-4000-8000-000000000001';

export function buildApp(repository: WorkoutRepository, logger?: FastifyBaseLogger) {
  const app = Fastify({ logger: logger ?? true });

  void app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/api/v1/exercises', async () => ({ items: await repository.listExercises() }));
  app.get('/api/v1/workouts', async () => ({
    items: await repository.listWorkouts(developmentUserId),
  }));

  app.post('/api/v1/workouts', async (request, reply) => {
    const parsed = createWorkoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const result = await repository.createWorkout(developmentUserId, parsed.data);
    return reply.status(result.duplicate ? 200 : 201).send(result);
  });

  app.post('/api/v1/sets', async (request, reply) => {
    const parsed = createSetSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    try {
      const result = await repository.createSet(developmentUserId, parsed.data);
      return reply.status(result.duplicate ? 200 : 201).send(result);
    } catch (error) {
      return reply
        .status(404)
        .send({ error: error instanceof Error ? error.message : 'Not found' });
    }
  });

  app.post('/api/v1/sync', async (request, reply) => {
    const parsed = syncMutationSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    try {
      const result =
        parsed.data.type === 'workout.create'
          ? await repository.createWorkout(developmentUserId, parsed.data.payload)
          : await repository.createSet(developmentUserId, parsed.data.payload);
      return reply.status(result.duplicate ? 200 : 201).send({ ...result, type: parsed.data.type });
    } catch (error) {
      return reply
        .status(409)
        .send({ error: error instanceof Error ? error.message : 'Sync failed' });
    }
  });

  return app;
}
