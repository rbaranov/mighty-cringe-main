import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from './app.js';
import { MemoryRepository } from './repository.js';

test('workout and set mutations are accepted once and safely retried', async () => {
  const app = buildApp(new MemoryRepository());
  await app.ready();

  const exercises = await app.inject({ method: 'GET', url: '/api/v1/exercises' });
  assert.equal(exercises.statusCode, 200);
  assert.equal((exercises.json() as { items: unknown[] }).items.length, 6);

  const workoutId = '20000000-0000-4000-8000-000000000001';
  const workoutMutationId = '30000000-0000-4000-8000-000000000001';
  const workout = {
    id: workoutId,
    clientMutationId: workoutMutationId,
    startedAt: '2026-07-20T08:00:00.000Z',
    locale: 'ru',
  };

  const firstWorkout = await app.inject({
    method: 'POST',
    url: '/api/v1/workouts',
    payload: workout,
  });
  assert.equal(firstWorkout.statusCode, 201);
  assert.equal(firstWorkout.json().duplicate, false);

  const repeatedWorkout = await app.inject({
    method: 'POST',
    url: '/api/v1/workouts',
    payload: workout,
  });
  assert.equal(repeatedWorkout.statusCode, 200);
  assert.equal(repeatedWorkout.json().duplicate, true);

  const set = {
    clientMutationId: '40000000-0000-4000-8000-000000000001',
    workoutId,
    set: {
      id: '50000000-0000-4000-8000-000000000001',
      exerciseId: '10000000-0000-4000-8000-000000000001',
      weightKg: 60,
      reps: 10,
      rir: 2,
      comment: 'Чисто',
      performedAt: '2026-07-20T08:12:00.000Z',
    },
  };

  const firstSet = await app.inject({ method: 'POST', url: '/api/v1/sets', payload: set });
  assert.equal(firstSet.statusCode, 201);
  const repeatedSet = await app.inject({ method: 'POST', url: '/api/v1/sets', payload: set });
  assert.equal(repeatedSet.statusCode, 200);
  assert.equal(repeatedSet.json().duplicate, true);

  const history = await app.inject({ method: 'GET', url: '/api/v1/workouts' });
  assert.equal(history.json().items[0].setCount, 1);

  await app.close();
});
