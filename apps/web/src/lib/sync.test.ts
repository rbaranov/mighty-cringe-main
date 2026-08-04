import 'fake-indexeddb/auto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SyncMutation } from '@mighty-cringe/contracts';

import { db } from './db';
import { createManualExercise } from './exercises';
import { toggleExercisePreference } from './exercisePreferences';
import {
  flushOutbox,
  getSyncStatus,
  queueMutation,
  refreshExercisePreferences,
  resolveConflict,
} from './sync';

const measuredOn = '2026-07-22T06:00:00.000Z';
const measurementId = '60000000-0000-4000-8000-000000000001';
const mutation = {
  type: 'measurement.create',
  payload: {
    id: measurementId,
    clientMutationId: '61000000-0000-4000-8000-000000000001',
    measuredOn,
    isSelfMeasured: true,
    values: {
      heightCm: null,
      weightKg: 80,
      neckCm: null,
      chestCm: null,
      bicepsCm: null,
      thighLeftCm: null,
      thighRightCm: null,
      calfCm: null,
      waistCm: 90,
      bodyFatPercent: null,
      rfmSex: null,
    },
  },
} satisfies SyncMutation;

describe('durable sync status', () => {
  beforeEach(async () => {
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
    vi.restoreAllMocks();
  });
  afterAll(async () => db.delete());

  it('acknowledges a queued offline measurement and records the successful sync time', async () => {
    await queueLocalMeasurement();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          entityType: 'measurement',
          entity: {
            id: measurementId,
            measuredOn,
            isSelfMeasured: true,
            values: mutation.payload.values,
            revision: 1,
            updatedAt: '2026-07-22T06:01:00.000Z',
          },
          duplicate: false,
        }),
      ),
    );

    await expect(flushOutbox()).resolves.toBe('success');

    expect(await db.outbox.count()).toBe(0);
    expect(await db.measurements.get(measurementId)).toMatchObject({
      revision: 1,
      syncState: 'synced',
    });
    expect(await db.meta.get('lastSuccessfulSyncAt')).toBeDefined();
    expect(getSyncStatus()).toEqual({ phase: 'idle', message: null });
  });

  it('keeps a failed mutation durable and exposes a retryable server error', async () => {
    await queueLocalMeasurement();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
    );

    await expect(flushOutbox()).resolves.toBe('retry');

    expect(await db.outbox.count()).toBe(1);
    expect(getSyncStatus()).toMatchObject({ phase: 'error' });
  });

  it('restores a missing workout creation before replaying an orphaned update', async () => {
    const workoutId = '60000000-0000-4000-8000-000000000002';
    const updateMutationId = '61000000-0000-4000-8000-000000000002';
    const startedAt = '2026-08-03T14:00:42.954Z';
    const endedAt = '2026-08-03T15:52:45.954Z';
    const localWorkout = {
      id: workoutId,
      startedAt,
      endedAt,
      durationSeconds: 6_723,
      activeSegmentStartedAt: null,
      lastActivityAt: endedAt,
      completionReason: 'manual' as const,
      isFavorite: false,
      notes: null,
      locale: 'ru' as const,
      exercises: [],
      revision: 0,
      updatedAt: endedAt,
      syncState: 'pending' as const,
    };
    await db.workouts.put(localWorkout);
    await db.outbox.put({
      id: updateMutationId,
      sequence: 1_785_765_739_661_000,
      createdAt: '2026-08-03T14:02:19.661Z',
      mutation: {
        type: 'workout.update',
        payload: {
          clientMutationId: updateMutationId,
          workoutId,
          baseRevision: 0,
          changes: { exercises: [] },
          activityAt: '2026-08-03T14:02:19.645Z',
        },
      },
    });

    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const sent = JSON.parse(String(init?.body)) as SyncMutation;
      if (sent.type === 'workout.create') {
        return Response.json({
          entityType: 'workout',
          entity: { ...localWorkout, revision: 1, syncState: undefined, sets: [] },
          duplicate: false,
        });
      }
      expect(sent).toMatchObject({
        type: 'workout.update',
        payload: { workoutId, baseRevision: 1 },
      });
      return Response.json({
        entityType: 'workout',
        entity: { ...localWorkout, revision: 2, syncState: undefined, sets: [] },
        duplicate: false,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(flushOutbox()).resolves.toBe('success');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const restoredCreate = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as SyncMutation;
    expect(restoredCreate).toMatchObject({
      type: 'workout.create',
      payload: {
        id: workoutId,
        startedAt,
        endedAt,
        durationSeconds: 6_723,
        lastActivityAt: endedAt,
        completionReason: 'manual',
      },
    });
    expect(await db.outbox.count()).toBe(0);
    expect(await db.workouts.get(workoutId)).toMatchObject({
      revision: 2,
      syncState: 'synced',
      endedAt,
      durationSeconds: 6_723,
    });
  });

  it('stops safely at a conflict instead of recreating the same repair forever', async () => {
    const workoutId = '60000000-0000-4000-8000-000000000003';
    const updateMutationId = '61000000-0000-4000-8000-000000000003';
    const startedAt = '2026-08-03T14:00:42.954Z';
    await db.workouts.put({
      id: workoutId,
      startedAt,
      endedAt: null,
      durationSeconds: 0,
      activeSegmentStartedAt: startedAt,
      lastActivityAt: startedAt,
      completionReason: null,
      isFavorite: false,
      notes: null,
      locale: 'ru',
      exercises: [],
      revision: 0,
      updatedAt: startedAt,
      syncState: 'pending',
    });
    await db.outbox.put({
      id: updateMutationId,
      sequence: 100,
      createdAt: startedAt,
      mutation: {
        type: 'workout.update',
        payload: {
          clientMutationId: updateMutationId,
          workoutId,
          baseRevision: 0,
          changes: { notes: 'Локальная версия' },
          activityAt: startedAt,
        },
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: 'revision_conflict',
          current: {
            id: workoutId,
            startedAt,
            endedAt: null,
            durationSeconds: 0,
            activeSegmentStartedAt: startedAt,
            lastActivityAt: startedAt,
            completionReason: null,
            isFavorite: false,
            notes: null,
            locale: 'ru',
            exercises: [],
            revision: 1,
            updatedAt: startedAt,
            sets: [],
          },
        },
        { status: 409 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(flushOutbox()).resolves.toBe('retry');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await db.conflicts.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
    expect(await db.workouts.get(workoutId)).toMatchObject({
      revision: 0,
      syncState: 'conflict',
    });
  });

  it('keeps an automatic workout completion queued while offline', async () => {
    const clientMutationId = '61000000-0000-4000-8000-000000000002';
    vi.stubGlobal('navigator', { onLine: false });

    await queueMutation({
      type: 'workout.update',
      payload: {
        clientMutationId,
        workoutId: '60000000-0000-4000-8000-000000000002',
        baseRevision: 1,
        changes: {
          endedAt: '2026-07-22T08:15:00.000Z',
          durationSeconds: 2_700,
          activeSegmentStartedAt: null,
          lastActivityAt: '2026-07-22T08:00:00.000Z',
          completionReason: 'automatic',
        },
        activityAt: '2026-07-22T08:00:00.000Z',
      },
    });

    await expect(flushOutbox()).resolves.toBe('offline');
    expect(await db.outbox.get(clientMutationId)).toMatchObject({
      mutation: {
        type: 'workout.update',
        payload: {
          clientMutationId,
          changes: { completionReason: 'automatic' },
        },
      },
    });
  });

  it('keeps a manually created exercise locally and synchronizes its durable mutation', async () => {
    vi.stubGlobal('navigator', { onLine: false });

    const exercise = await createManualExercise({
      name: 'Отведение руки с гантелью лёжа на боку',
      locale: 'ru',
      primaryMuscle: 'middle_delt',
    });

    expect(await db.exercises.get(exercise.id)).toMatchObject({
      nameRu: exercise.nameRu,
      syncState: 'pending',
    });
    const queued = await db.outbox.orderBy('sequence').first();
    expect(queued?.mutation).toMatchObject({
      type: 'exercise.create',
      payload: { id: exercise.id, sources: [], videos: [] },
    });

    vi.stubGlobal('navigator', { onLine: true });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ entityType: 'exercise', entity: exercise, duplicate: false }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(flushOutbox()).resolves.toBe('success');
    expect(await db.outbox.count()).toBe(0);
    expect(await db.exercises.get(exercise.id)).toMatchObject({ syncState: 'synced' });
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as SyncMutation;
    expect(sent.type).toBe('exercise.create');
  });

  it('keeps preference toggles durable offline and replays newer changes in order', async () => {
    const exerciseId = '10000000-0000-4000-8000-000000000001';
    vi.stubGlobal('navigator', { onLine: false });

    await toggleExercisePreference(exerciseId, 'like');
    await expect(flushOutbox()).resolves.toBe('offline');
    await toggleExercisePreference(exerciseId, 'dislike');
    await expect(flushOutbox()).resolves.toBe('offline');

    expect(await db.exercisePreferences.get(exerciseId)).toMatchObject({
      value: 'dislike',
      revision: 0,
      syncState: 'pending',
    });
    expect(await db.outbox.count()).toBe(2);

    db.close();
    await db.open();
    expect(await db.exercisePreferences.get(exerciseId)).toMatchObject({ value: 'dislike' });

    vi.stubGlobal('navigator', { onLine: true });
    let revision = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const sent = JSON.parse(String(init?.body)) as SyncMutation;
      assertPreferenceMutation(sent);
      expect(sent.payload.baseRevision).toBe(revision);
      revision += 1;
      return Response.json({
        entityType: 'exercisePreference',
        entity: {
          exerciseId,
          value: sent.payload.value,
          revision,
          updatedAt: `2026-08-05T08:0${revision}:00.000Z`,
        },
        duplicate: false,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(flushOutbox()).resolves.toBe('success');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.exercisePreferences.get(exerciseId)).toMatchObject({
      value: 'dislike',
      revision: 2,
      syncState: 'synced',
    });
  });

  it('removes an active preference when the same control is pressed again', async () => {
    const exerciseId = '10000000-0000-4000-8000-000000000003';
    vi.stubGlobal('navigator', { onLine: false });

    await toggleExercisePreference(exerciseId, 'like');
    await expect(flushOutbox()).resolves.toBe('offline');
    await toggleExercisePreference(exerciseId, 'like');
    await expect(flushOutbox()).resolves.toBe('offline');

    expect(await db.exercisePreferences.get(exerciseId)).toMatchObject({
      value: null,
      syncState: 'pending',
    });
  });

  it('does not rewrite an existing workout or saved draft when a preference changes', async () => {
    const exerciseId = '10000000-0000-4000-8000-000000000010';
    const workoutId = '60000000-0000-4000-8000-000000000010';
    const plan = [
      {
        id: '20000000-0000-4000-8000-000000000010',
        exerciseId,
        position: 0,
        supersetGroup: null,
      },
    ];
    const workout = {
      id: workoutId,
      startedAt: '2026-08-05T08:00:00.000Z',
      endedAt: null,
      durationSeconds: 0,
      activeSegmentStartedAt: '2026-08-05T08:00:00.000Z',
      lastActivityAt: '2026-08-05T08:00:00.000Z',
      completionReason: null,
      isFavorite: false,
      notes: null,
      locale: 'ru' as const,
      exercises: plan,
      revision: 1,
      updatedAt: '2026-08-05T08:00:00.000Z',
      syncState: 'synced' as const,
    };
    const savedDraft = JSON.stringify(plan);
    await db.workouts.put(workout);
    await db.meta.put({ key: 'draftWorkoutPlan', value: savedDraft });
    vi.stubGlobal('navigator', { onLine: false });

    await toggleExercisePreference(exerciseId, 'dislike');
    await expect(flushOutbox()).resolves.toBe('offline');

    expect(await db.workouts.get(workoutId)).toEqual(workout);
    expect((await db.meta.get('draftWorkoutPlan'))?.value).toBe(savedDraft);
    expect((await db.outbox.toArray()).map((item) => item.mutation.type)).toEqual([
      'exercise-preference.set',
    ]);
  });

  it('refreshes server preferences while preserving local pending and conflicted choices', async () => {
    const syncedId = '10000000-0000-4000-8000-000000000005';
    const pendingId = '10000000-0000-4000-8000-000000000006';
    const conflictId = '10000000-0000-4000-8000-000000000007';
    const missingId = '10000000-0000-4000-8000-000000000008';
    const newId = '10000000-0000-4000-8000-000000000009';
    await db.exercisePreferences.bulkPut([
      {
        exerciseId: syncedId,
        value: 'like',
        revision: 1,
        updatedAt: '2026-08-05T08:00:00.000Z',
        syncState: 'synced',
      },
      {
        exerciseId: pendingId,
        value: 'like',
        revision: 1,
        updatedAt: '2026-08-05T08:00:00.000Z',
        syncState: 'pending',
      },
      {
        exerciseId: conflictId,
        value: 'dislike',
        revision: 1,
        updatedAt: '2026-08-05T08:00:00.000Z',
        syncState: 'conflict',
      },
      {
        exerciseId: missingId,
        value: 'like',
        revision: 1,
        updatedAt: '2026-08-05T08:00:00.000Z',
        syncState: 'synced',
      },
    ]);
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          items: [
            {
              exerciseId: syncedId,
              value: 'dislike',
              revision: 2,
              updatedAt: '2026-08-05T08:01:00.000Z',
            },
            {
              exerciseId: pendingId,
              value: 'dislike',
              revision: 2,
              updatedAt: '2026-08-05T08:01:00.000Z',
            },
            {
              exerciseId: conflictId,
              value: 'like',
              revision: 2,
              updatedAt: '2026-08-05T08:01:00.000Z',
            },
            {
              exerciseId: newId,
              value: 'like',
              revision: 1,
              updatedAt: '2026-08-05T08:01:00.000Z',
            },
          ],
        }),
      ),
    );

    await expect(refreshExercisePreferences()).resolves.toBe('success');

    expect(await db.exercisePreferences.get(syncedId)).toMatchObject({
      value: 'dislike',
      revision: 2,
      syncState: 'synced',
    });
    expect(await db.exercisePreferences.get(pendingId)).toMatchObject({
      value: 'like',
      revision: 1,
      syncState: 'pending',
    });
    expect(await db.exercisePreferences.get(conflictId)).toMatchObject({
      value: 'dislike',
      revision: 1,
      syncState: 'conflict',
    });
    expect(await db.exercisePreferences.get(newId)).toMatchObject({
      value: 'like',
      revision: 1,
      syncState: 'synced',
    });
    expect(await db.exercisePreferences.get(missingId)).toBeUndefined();
  });

  it('stores a preference conflict and can explicitly keep the server version', async () => {
    const exerciseId = '10000000-0000-4000-8000-000000000002';
    const mutationId = '94000000-0000-4000-8000-000000000001';
    await db.exercisePreferences.put({
      exerciseId,
      value: 'like',
      revision: 1,
      updatedAt: '2026-08-05T08:00:00.000Z',
      syncState: 'pending',
    });
    await db.outbox.put({
      id: mutationId,
      sequence: 1,
      createdAt: '2026-08-05T08:00:00.000Z',
      mutation: {
        type: 'exercise-preference.set',
        payload: {
          clientMutationId: mutationId,
          exerciseId,
          value: 'like',
          baseRevision: 1,
        },
      },
    });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            code: 'revision_conflict',
            error: 'The record changed on another client',
            current: {
              exerciseId,
              value: 'dislike',
              revision: 2,
              updatedAt: '2026-08-05T08:01:00.000Z',
            },
          },
          { status: 409 },
        ),
      ),
    );

    await expect(flushOutbox()).resolves.toBe('success');

    expect(await db.exercisePreferences.get(exerciseId)).toMatchObject({ syncState: 'conflict' });
    expect(await db.conflicts.get(mutationId)).toMatchObject({
      entityType: 'exercisePreference',
      entityId: exerciseId,
      current: { value: 'dislike', revision: 2 },
    });

    await resolveConflict(mutationId, 'server');

    expect(await db.conflicts.count()).toBe(0);
    expect(await db.exercisePreferences.get(exerciseId)).toMatchObject({
      value: 'dislike',
      revision: 2,
      syncState: 'synced',
    });
  });

  it('rebases a preference conflict when the athlete keeps the local version', async () => {
    const exerciseId = '10000000-0000-4000-8000-000000000004';
    const mutationId = '94000000-0000-4000-8000-000000000002';
    await db.exercisePreferences.put({
      exerciseId,
      value: 'like',
      revision: 1,
      updatedAt: '2026-08-05T08:00:00.000Z',
      syncState: 'pending',
    });
    await db.outbox.put({
      id: mutationId,
      sequence: 1,
      createdAt: '2026-08-05T08:00:00.000Z',
      mutation: {
        type: 'exercise-preference.set',
        payload: {
          clientMutationId: mutationId,
          exerciseId,
          value: 'like',
          baseRevision: 1,
        },
      },
    });
    vi.stubGlobal('navigator', { onLine: true });
    let requestCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      requestCount += 1;
      if (requestCount === 1) {
        return Response.json(
          {
            code: 'revision_conflict',
            error: 'The record changed on another client',
            current: {
              exerciseId,
              value: 'dislike',
              revision: 2,
              updatedAt: '2026-08-05T08:01:00.000Z',
            },
          },
          { status: 409 },
        );
      }
      const sent = JSON.parse(String(init?.body)) as SyncMutation;
      assertPreferenceMutation(sent);
      expect(sent.payload).toMatchObject({ exerciseId, value: 'like', baseRevision: 2 });
      return Response.json({
        entityType: 'exercisePreference',
        entity: {
          exerciseId,
          value: 'like',
          revision: 3,
          updatedAt: '2026-08-05T08:02:00.000Z',
        },
        duplicate: false,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(flushOutbox()).resolves.toBe('success');
    await resolveConflict(mutationId, 'mine');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await db.conflicts.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.exercisePreferences.get(exerciseId)).toMatchObject({
      value: 'like',
      revision: 3,
      syncState: 'synced',
    });
  });
});

function assertPreferenceMutation(
  mutation: SyncMutation,
): asserts mutation is Extract<SyncMutation, { type: 'exercise-preference.set' }> {
  expect(mutation.type).toBe('exercise-preference.set');
}

async function queueLocalMeasurement() {
  await db.measurements.put({
    id: measurementId,
    measuredOn,
    isSelfMeasured: true,
    values: mutation.payload.values,
    revision: 0,
    updatedAt: measuredOn,
    syncState: 'pending',
    deleted: false,
  });
  await db.outbox.put({
    id: mutation.payload.clientMutationId,
    sequence: 1,
    createdAt: measuredOn,
    mutation,
  });
}
