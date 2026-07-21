import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PostgresRepository, RepositoryConflictError } from './repository.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'PostgreSQL applies retries atomically and returns revisioned history',
  { skip: databaseUrl ? false : 'DATABASE_URL is not configured' },
  async (context) => {
    assert.ok(databaseUrl);
    const repository = new PostgresRepository(databaseUrl);
    context.after(() => repository.close());
    await repository.initialize();

    const user = await repository.upsertGoogleUser(
      {
        subject: `integration-${randomUUID()}`,
        email: `${randomUUID()}@example.test`,
        displayName: 'Integration Athlete',
        avatarUrl: null,
      },
      'athlete',
    );
    const workoutId = randomUUID();
    const createWorkout = {
      id: workoutId,
      clientMutationId: randomUUID(),
      startedAt: '2026-07-21T10:00:00.000Z',
      endedAt: null,
      notes: null,
      locale: 'ru' as const,
    };

    const concurrentCreates = await Promise.all([
      repository.createWorkout(user.id, createWorkout),
      repository.createWorkout(user.id, createWorkout),
    ]);
    assert.equal(concurrentCreates.filter((result) => result.duplicate).length, 1);
    assert.equal(concurrentCreates.filter((result) => !result.duplicate).length, 1);

    const setId = randomUUID();
    const createdSet = await repository.createSet(user.id, {
      clientMutationId: randomUUID(),
      workoutId,
      set: {
        id: setId,
        exerciseId: '10000000-0000-4000-8000-000000000001',
        weightKg: 80,
        reps: 5,
        rir: 1,
        comment: null,
        performedAt: '2026-07-21T10:10:00.000Z',
      },
    });
    assert.equal(createdSet.entity.revision, 1);

    const updateMutationId = randomUUID();
    const updatedSet = await repository.updateSet(user.id, {
      clientMutationId: updateMutationId,
      workoutId,
      setId,
      baseRevision: 1,
      changes: { weightKg: 82.5 },
    });
    assert.equal(updatedSet.entity.revision, 2);
    assert.equal('weightKg' in updatedSet.entity && updatedSet.entity.weightKg, 82.5);

    const repeatedUpdate = await repository.updateSet(user.id, {
      clientMutationId: updateMutationId,
      workoutId,
      setId,
      baseRevision: 1,
      changes: { weightKg: 82.5 },
    });
    assert.equal(repeatedUpdate.duplicate, true);
    assert.equal(repeatedUpdate.entity.revision, 2);

    await assert.rejects(
      repository.updateSet(user.id, {
        clientMutationId: randomUUID(),
        workoutId,
        setId,
        baseRevision: 1,
        changes: { weightKg: 85 },
      }),
      RepositoryConflictError,
    );

    const concurrentUpdates = await Promise.allSettled([
      repository.updateSet(user.id, {
        clientMutationId: randomUUID(),
        workoutId,
        setId,
        baseRevision: 2,
        changes: { weightKg: 83 },
      }),
      repository.updateSet(user.id, {
        clientMutationId: randomUUID(),
        workoutId,
        setId,
        baseRevision: 2,
        changes: { weightKg: 84 },
      }),
    ]);
    assert.equal(concurrentUpdates.filter((result) => result.status === 'fulfilled').length, 1);
    const rejectedUpdate = concurrentUpdates.find((result) => result.status === 'rejected');
    assert.ok(rejectedUpdate?.status === 'rejected');
    assert.ok(rejectedUpdate.reason instanceof RepositoryConflictError);

    const history = await repository.listWorkouts(user.id);
    assert.equal(history.length, 1);
    assert.equal(history[0].sets.length, 1);
    assert.ok([83, 84].includes(history[0].sets[0].weightKg));
    assert.equal(history[0].sets[0].revision, 3);
  },
);
