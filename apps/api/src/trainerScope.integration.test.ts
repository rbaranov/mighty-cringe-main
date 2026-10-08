import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createWorkoutSchema } from '@mighty-cringe/contracts';
import { buildApp } from './app.js';
import { PostgresRepository, RepositoryTrainerAccessError } from './repository.js';

const databaseUrl = process.env.DATABASE_URL;
test(
  'PostgreSQL trainer operations commit with audit, serialize revocation and roll back together',
  { skip: databaseUrl ? false : 'DATABASE_URL is not configured' },
  async (t) => {
    assert.ok(databaseUrl);
    const repository = new PostgresRepository(databaseUrl);
    t.after(() => repository.close());
    await repository.initialize();
    const user = async (role: 'athlete' | 'trainer') => {
      const id = randomUUID();
      return repository.upsertGoogleUser(
        { subject: id, email: `${id}@example.test`, displayName: role, avatarUrl: null },
        role,
      );
    };
    const athlete = await user('athlete');
    const trainer = await user('trainer');
    const tokenHash = randomUUID();
    await repository.createTrainerInvite(
      {
        id: randomUUID(),
        trainerId: trainer.id,
        email: athlete.email,
        tokenHash,
        expiresAt: new Date(Date.now() + 60000),
      },
      new Date(),
    );
    const initial = await repository.acceptTrainerInvite(
      tokenHash,
      athlete.id,
      athlete.email,
      new Date(),
    );
    assert.equal(initial.access, 'read');
    const grant = await repository.updateTrainerAccess(athlete.id, 'manage', new Date());
    const scope = {
      actorId: trainer.id,
      athleteId: athlete.id,
      linkId: grant.linkId,
      write: true,
      operation: 'workout.create',
      details: {},
    };
    const discarded = createWorkoutSchema.parse({
      id: randomUUID(),
      clientMutationId: randomUUID(),
      startedAt: new Date().toISOString(),
    });
    await assert.rejects(
      repository.withTrainerAccess(scope, async () => {
        await repository.createWorkout(athlete.id, discarded);
        throw new Error('rollback audit and mutation');
      }),
      /rollback audit/,
    );
    assert.equal((await repository.listWorkouts(athlete.id)).length, 0);
    assert.equal((await repository.listJournalActivity(athlete.id)).length, 0);

    const app = buildApp(repository, { developmentUser: trainer, logger: false as never });
    t.after(() => app.close());
    const headers = { 'x-athlete-id': athlete.id, 'x-trainer-link-id': grant.linkId };
    const workoutId = randomUUID();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/workouts',
      headers,
      payload: {
        id: workoutId,
        clientMutationId: randomUUID(),
        startedAt: new Date().toISOString(),
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal((await repository.listWorkouts(athlete.id))[0].id, workoutId);
    assert.equal((await repository.listJournalActivity(athlete.id))[0].action, 'workout.create');
    const sets = await Promise.all(
      [0, 1].map(() =>
        app.inject({
          method: 'POST',
          url: '/api/v1/sets',
          headers,
          payload: {
            clientMutationId: randomUUID(),
            workoutId,
            set: {
              id: randomUUID(),
              exerciseId: '10000000-0000-4000-8000-000000000001',
              reps: 10,
              weightKg: 60,
              rir: null,
              comment: null,
              position: 0,
              performedAt: new Date().toISOString(),
            },
          },
        }),
      ),
    );
    assert.ok(sets.every((response) => response.statusCode === 201));
    assert.deepEqual(sets.map((response) => response.json().entity.position).sort(), [0, 1]);

    let entered!: () => void;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inFlight = repository.withTrainerAccess({ ...scope, write: false }, async () => {
      entered();
      await hold;
      return { value: true, successful: true };
    });
    await inside;
    let revoked = false;
    const revoke = repository.updateTrainerAccess(athlete.id, 'read', new Date()).then(() => {
      revoked = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(revoked, false);
    release();
    await Promise.all([inFlight, revoke]);
    await assert.rejects(
      repository.withTrainerAccess(scope, async () => ({ value: true, successful: true })),
      RepositoryTrainerAccessError,
    );
    await repository.updateTrainerAccess(athlete.id, 'manage', new Date());
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/v1/workouts', headers })).statusCode,
      403,
    );
  },
);
