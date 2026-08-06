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
    const firstPlanItemId = randomUUID();
    const secondPlanItemId = randomUUID();
    const createWorkout = {
      id: workoutId,
      clientMutationId: randomUUID(),
      startedAt: '2026-07-21T10:00:00.000Z',
      endedAt: null,
      durationSeconds: 0,
      activeSegmentStartedAt: '2026-07-21T10:00:00.000Z',
      lastActivityAt: '2026-07-21T10:00:00.000Z',
      completionReason: null,
      isFavorite: false,
      notes: null,
      locale: 'ru' as const,
      exercises: [
        {
          id: firstPlanItemId,
          exerciseId: '10000000-0000-4000-8000-000000000001',
          position: 0,
          supersetGroup: 1,
        },
        {
          id: secondPlanItemId,
          exerciseId: '10000000-0000-4000-8000-000000000002',
          position: 1,
          supersetGroup: 1,
        },
      ],
    };

    const concurrentCreates = await Promise.all([
      repository.createWorkout(user.id, createWorkout),
      repository.createWorkout(user.id, createWorkout),
    ]);
    assert.equal(concurrentCreates.filter((result) => result.duplicate).length, 1);
    assert.equal(concurrentCreates.filter((result) => !result.duplicate).length, 1);

    const reorderedPlan = await repository.updateWorkout(user.id, {
      clientMutationId: randomUUID(),
      workoutId,
      baseRevision: 1,
      changes: {
        exercises: [
          { ...createWorkout.exercises[1], position: 0 },
          { ...createWorkout.exercises[0], position: 1 },
        ],
      },
    });
    assert.equal(reorderedPlan.entity.revision, 2);
    assert.equal(reorderedPlan.entity.exercises[0].id, secondPlanItemId);

    const favoriteWorkout = await repository.updateWorkout(user.id, {
      clientMutationId: randomUUID(),
      workoutId,
      baseRevision: 2,
      changes: {
        isFavorite: true,
        notes: 'Мало спал, но рабочие веса шли уверенно.',
      },
    });
    assert.equal(favoriteWorkout.entity.revision, 3);
    assert.equal(favoriteWorkout.entity.isFavorite, true);
    assert.equal(favoriteWorkout.entity.notes, 'Мало спал, но рабочие веса шли уверенно.');

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
        entrySource: 'voice_ai',
        performedAt: '2026-07-21T10:10:00.000Z',
        position: 0,
      },
    });
    assert.equal(createdSet.entity.revision, 1);
    assert.equal(createdSet.entity.entrySource, 'voice_ai');

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
    assert.equal(history[0].revision, 3);
    assert.equal(history[0].isFavorite, true);
    assert.equal(history[0].notes, 'Мало спал, но рабочие веса шли уверенно.');
    assert.equal(history[0].exercises[0].id, secondPlanItemId);

    await assert.rejects(
      repository.deleteSet(user.id, {
        clientMutationId: randomUUID(),
        workoutId,
        setId,
        baseRevision: 2,
      }),
      RepositoryConflictError,
    );
    const deleteMutationId = randomUUID();
    const deleted = await repository.deleteSet(user.id, {
      clientMutationId: deleteMutationId,
      workoutId,
      setId,
      baseRevision: 3,
    });
    assert.equal(deleted.entity, null);
    assert.equal(deleted.duplicate, false);
    const repeatedDelete = await repository.deleteSet(user.id, {
      clientMutationId: deleteMutationId,
      workoutId,
      setId,
      baseRevision: 3,
    });
    assert.equal(repeatedDelete.duplicate, true);
    assert.equal((await repository.listWorkouts(user.id))[0].sets.length, 0);

    const measurementId = randomUUID();
    const measurementValues = {
      heightCm: 180,
      weightKg: 82,
      neckCm: null,
      chestCm: 102,
      bicepsCm: null,
      thighLeftCm: null,
      thighRightCm: null,
      calfCm: null,
      waistCm: 91,
      bodyFatPercent: null,
      rfmSex: 'male' as const,
    };
    const createMeasurement = {
      id: measurementId,
      clientMutationId: randomUUID(),
      measuredOn: '2026-01-22T06:00:00.000Z',
      isSelfMeasured: true,
      values: measurementValues,
    };
    const concurrentMeasurementCreates = await Promise.all([
      repository.createMeasurement(user.id, createMeasurement),
      repository.createMeasurement(user.id, createMeasurement),
    ]);
    assert.equal(concurrentMeasurementCreates.filter((result) => result.duplicate).length, 1);

    const updatedMeasurement = await repository.updateMeasurement(user.id, {
      clientMutationId: randomUUID(),
      measurementId,
      baseRevision: 1,
      changes: { values: { ...measurementValues, weightKg: 80.5, waistCm: 88.5 } },
    });
    assert.equal(updatedMeasurement.entity.revision, 2);
    assert.equal(updatedMeasurement.entity.values.weightKg, 80.5);
    await assert.rejects(
      repository.updateMeasurement(user.id, {
        clientMutationId: randomUUID(),
        measurementId,
        baseRevision: 1,
        changes: { isSelfMeasured: false },
      }),
      RepositoryConflictError,
    );
    assert.equal((await repository.listMeasurements(user.id)).length, 1);

    const otherUser = await repository.upsertGoogleUser(
      {
        subject: `integration-${randomUUID()}`,
        email: `${randomUUID()}@example.test`,
        displayName: 'Other Athlete',
        avatarUrl: null,
      },
      'athlete',
    );
    assert.deepEqual(await repository.listMeasurements(otherUser.id), []);

    const preferenceExerciseId = '10000000-0000-4000-8000-000000000001';
    const createPreference = {
      clientMutationId: randomUUID(),
      exerciseId: preferenceExerciseId,
      value: 'like' as const,
      baseRevision: 0,
    };
    const concurrentPreferenceCreates = await Promise.all([
      repository.setExercisePreference(user.id, createPreference),
      repository.setExercisePreference(user.id, createPreference),
    ]);
    assert.equal(concurrentPreferenceCreates.filter((result) => result.duplicate).length, 1);
    const conflictingPreferenceExerciseId = '10000000-0000-4000-8000-000000000002';
    const conflictingPreferenceCreates = await Promise.allSettled([
      repository.setExercisePreference(user.id, {
        clientMutationId: randomUUID(),
        exerciseId: conflictingPreferenceExerciseId,
        value: 'like',
        baseRevision: 0,
      }),
      repository.setExercisePreference(user.id, {
        clientMutationId: randomUUID(),
        exerciseId: conflictingPreferenceExerciseId,
        value: 'dislike',
        baseRevision: 0,
      }),
    ]);
    assert.equal(
      conflictingPreferenceCreates.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    const rejectedPreference = conflictingPreferenceCreates.find(
      (result) => result.status === 'rejected',
    );
    assert.ok(rejectedPreference && rejectedPreference.status === 'rejected');
    assert.ok(rejectedPreference.reason instanceof RepositoryConflictError);
    const dislikedPreference = await repository.setExercisePreference(user.id, {
      clientMutationId: randomUUID(),
      exerciseId: preferenceExerciseId,
      value: 'dislike',
      baseRevision: 1,
    });
    assert.equal(dislikedPreference.entity.revision, 2);
    await assert.rejects(
      repository.setExercisePreference(user.id, {
        clientMutationId: randomUUID(),
        exerciseId: preferenceExerciseId,
        value: 'like',
        baseRevision: 1,
      }),
      RepositoryConflictError,
    );
    assert.deepEqual(await repository.listExercisePreferences(otherUser.id), []);
    assert.deepEqual(
      (await repository.listExercisePreferences(user.id))
        .filter((preference) => preference.exerciseId === preferenceExerciseId)
        .map(({ value, revision }) => ({ value, revision })),
      [{ value: 'dislike', revision: 2 }],
    );

    const deleteMeasurementId = randomUUID();
    await repository.createMeasurement(user.id, {
      ...createMeasurement,
      id: deleteMeasurementId,
      clientMutationId: randomUUID(),
      measuredOn: '2025-03-23T06:00:00.000Z',
    });
    const deleteMeasurementMutationId = randomUUID();
    const deletedMeasurement = await repository.deleteMeasurement(user.id, {
      clientMutationId: deleteMeasurementMutationId,
      measurementId: deleteMeasurementId,
      baseRevision: 1,
    });
    assert.equal(deletedMeasurement.duplicate, false);
    const repeatedMeasurementDelete = await repository.deleteMeasurement(user.id, {
      clientMutationId: deleteMeasurementMutationId,
      measurementId: deleteMeasurementId,
      baseRevision: 1,
    });
    assert.equal(repeatedMeasurementDelete.duplicate, true);
    assert.equal((await repository.listMeasurements(user.id)).length, 1);

    const trainer = await repository.upsertGoogleUser(
      {
        subject: `integration-${randomUUID()}`,
        email: `${randomUUID()}@example.test`,
        displayName: 'Integration Trainer',
        avatarUrl: null,
      },
      'trainer',
    );
    const inviteNow = new Date('2026-07-22T00:00:00.000Z');
    const tokenHash = `${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    const invite = await repository.createTrainerInvite(
      {
        id: randomUUID(),
        trainerId: trainer.id,
        email: user.email,
        tokenHash,
        expiresAt: new Date('2026-07-29T00:00:00.000Z'),
      },
      inviteNow,
    );
    assert.equal(invite.status, 'pending');
    const acceptedTrainer = await repository.acceptTrainerInvite(
      tokenHash,
      user.id,
      user.email,
      inviteNow,
    );
    assert.equal(acceptedTrainer.id, trainer.id);
    assert.equal((await repository.listTrainerAthletes(trainer.id))[0].id, user.id);
    assert.equal((await repository.listSharedWorkouts(trainer.id, user.id)).length, 1);
    assert.equal((await repository.listSharedMeasurements(trainer.id, user.id)).length, 1);
    await assert.rejects(
      repository.deleteWorkout(user.id, {
        clientMutationId: randomUUID(),
        workoutId,
        baseRevision: 1,
      }),
      RepositoryConflictError,
    );
    const deleteWorkoutMutationId = randomUUID();
    const deletedWorkout = await repository.deleteWorkout(user.id, {
      clientMutationId: deleteWorkoutMutationId,
      workoutId,
      baseRevision: 3,
    });
    assert.equal(deletedWorkout.duplicate, false);
    const repeatedWorkoutDelete = await repository.deleteWorkout(user.id, {
      clientMutationId: deleteWorkoutMutationId,
      workoutId,
      baseRevision: 3,
    });
    assert.equal(repeatedWorkoutDelete.duplicate, true);
    assert.deepEqual(await repository.listWorkouts(user.id), []);
    assert.deepEqual(await repository.listSharedWorkouts(trainer.id, user.id), []);
    assert.equal(await repository.revokeAthleteTrainer(user.id, inviteNow), true);
    await assert.rejects(repository.listSharedWorkouts(trainer.id, user.id), /Record not found/);
  },
);
