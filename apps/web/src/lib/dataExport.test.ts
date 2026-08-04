import 'fake-indexeddb/auto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Exercise } from '@mighty-cringe/contracts';

import {
  clearLocalUserData,
  db,
  type LocalMeasurement,
  type LocalSet,
  type LocalWorkout,
} from './db';
import {
  buildLocalDataExport,
  deliverLocalDataExport,
  loadLocalDataExport,
  localDataExportFileName,
  serializeLocalDataExport,
} from './dataExport';

const workout: LocalWorkout = {
  id: '10000000-0000-4000-8000-000000000001',
  startedAt: '2026-08-03T13:00:00.000Z',
  endedAt: '2026-08-03T14:00:00.000Z',
  durationSeconds: 3_600,
  activeSegmentStartedAt: null,
  lastActivityAt: '2026-08-03T14:00:00.000Z',
  completionReason: 'manual',
  isFavorite: false,
  notes: null,
  locale: 'ru',
  exercises: [
    {
      id: '20000000-0000-4000-8000-000000000001',
      exerciseId: '30000000-0000-4000-8000-000000000001',
      position: 0,
      supersetGroup: null,
    },
  ],
  revision: 0,
  updatedAt: '2026-08-03T14:00:00.000Z',
  syncState: 'pending',
};

const set: LocalSet = {
  id: '40000000-0000-4000-8000-000000000001',
  workoutId: workout.id,
  exerciseId: workout.exercises[0]!.exerciseId,
  weightKg: 60,
  reps: 9,
  rir: 1,
  comment: null,
  entrySource: 'manual',
  performedAt: '2026-08-03T13:30:00.000Z',
  position: 0,
  revision: 0,
  updatedAt: '2026-08-03T13:30:00.000Z',
  syncState: 'pending',
  deleted: false,
};

const measurement: LocalMeasurement = {
  id: '50000000-0000-4000-8000-000000000001',
  measuredOn: '2026-08-02T06:00:00.000Z',
  isSelfMeasured: true,
  values: {
    heightCm: 180,
    weightKg: 80,
    neckCm: null,
    chestCm: null,
    bicepsCm: null,
    thighLeftCm: null,
    thighRightCm: null,
    calfCm: null,
    waistCm: null,
    bodyFatPercent: null,
    rfmSex: 'male',
  },
  revision: 1,
  updatedAt: '2026-08-02T06:00:00.000Z',
  syncState: 'conflict',
  deleted: false,
};

const usedExercise: Exercise = {
  id: workout.exercises[0]!.exerciseId,
  scope: 'global',
  nameRu: 'Жим штанги лёжа',
  nameEn: 'Bench press',
  aliases: [],
  tag: 'normal',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['triceps'],
  equipment: ['barbell'],
};

const unusedGlobalExercise: Exercise = {
  ...usedExercise,
  id: '30000000-0000-4000-8000-000000000002',
  nameRu: 'Неиспользуемое глобальное',
  nameEn: 'Unused global',
};

const personalExercise: Exercise = {
  ...usedExercise,
  id: '30000000-0000-4000-8000-000000000003',
  scope: 'user',
  nameRu: 'Личное упражнение',
  nameEn: 'Personal exercise',
};

const exercisePreference = {
  exerciseId: usedExercise.id,
  value: 'like' as const,
  revision: 1,
  updatedAt: '2026-08-03T12:00:00.000Z',
  syncState: 'pending' as const,
};

const options = {
  exportedAt: '2026-08-03T19:12:34.567Z',
  locale: 'ru' as const,
  unitSystem: 'metric' as const,
};

describe('local training data export', () => {
  beforeEach(async () => clearLocalUserData());
  afterAll(async () => db.delete());

  it('exports visible local records, unsynced states, and only relevant exercises', () => {
    const result = buildLocalDataExport(
      {
        workouts: [workout],
        sets: [set, { ...set, id: '40000000-0000-4000-8000-000000000002', deleted: true }],
        measurements: [measurement],
        exercises: [unusedGlobalExercise, personalExercise, usedExercise],
        exercisePreferences: [exercisePreference],
      },
      options,
    );

    expect(result).toMatchObject({
      format: 'mighty-cringe.local-data',
      formatVersion: 2,
      exportedAt: options.exportedAt,
      source: {
        scope: 'this-device',
        locale: 'ru',
        unitSystem: 'metric',
        canonicalUnits: { weight: 'kg', length: 'cm' },
      },
      summary: {
        workouts: 1,
        sets: 1,
        measurements: 1,
        exercises: 2,
        exercisePreferences: 1,
        pendingRecords: 3,
        conflictedRecords: 1,
      },
    });
    expect(result.data.sets[0]).not.toHaveProperty('deleted');
    expect(result.data.exercises.map((exercise) => exercise.id)).toEqual([
      usedExercise.id,
      personalExercise.id,
    ]);
    expect(result.data.exercisePreferences).toEqual([exercisePreference]);
  });

  it('reads the current device database without leaking metadata or the sync queue', async () => {
    await db.workouts.put(workout);
    await db.sets.put(set);
    await db.measurements.put(measurement);
    await db.exercises.bulkPut([usedExercise, personalExercise]);
    await db.exercisePreferences.put(exercisePreference);
    await db.meta.bulkPut([
      { key: 'activeUserId', value: '60000000-0000-4000-8000-000000000001' },
      { key: 'offlineSessionAllowed', value: 'true' },
      { key: 'cachedCurrentUser', value: 'private-session-profile' },
    ]);
    await db.outbox.put({
      id: '70000000-0000-4000-8000-000000000001',
      sequence: 1,
      createdAt: '2026-08-03T13:00:00.000Z',
      mutation: {
        type: 'workout.touch',
        payload: {
          clientMutationId: '80000000-0000-4000-8000-000000000001',
          workoutId: workout.id,
          activityAt: '2026-08-03T13:30:00.000Z',
        },
      },
    });

    const serialized = serializeLocalDataExport(await loadLocalDataExport(options));

    expect(serialized).toContain(workout.id);
    expect(serialized).toContain('"syncState": "pending"');
    expect(serialized).not.toContain('private-session-profile');
    expect(serialized).not.toContain('offlineSessionAllowed');
    expect(serialized).not.toContain('clientMutationId');
    expect(serialized).not.toContain('80000000-0000-4000-8000-000000000001');
  });

  it('uses a timestamped, filesystem-safe file name', () => {
    expect(localDataExportFileName(options.exportedAt)).toBe(
      'mighty-cringe-export-2026-08-03T19-12-34Z.json',
    );
  });

  it('opens native file sharing when the browser supports it', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const download = vi.fn();
    const createFile = (contents: string, fileName: string) =>
      new File([contents], fileName, { type: 'application/json' });
    const data = buildLocalDataExport(
      {
        workouts: [workout],
        sets: [set],
        measurements: [],
        exercises: [usedExercise],
        exercisePreferences: [],
      },
      options,
    );

    await expect(
      deliverLocalDataExport(data, { createFile, canShare: () => true, share, download }),
    ).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [expect.objectContaining({ name: expect.any(String) })],
        title: 'MightyCringe — экспорт данных',
      }),
    );
    expect(download).not.toHaveBeenCalled();
  });

  it('falls back to a regular download when file sharing is unavailable', async () => {
    const download = vi.fn();
    const createFile = (contents: string, fileName: string) =>
      new File([contents], fileName, { type: 'application/json' });
    const data = buildLocalDataExport(
      { workouts: [], sets: [], measurements: [], exercises: [], exercisePreferences: [] },
      options,
    );

    await expect(deliverLocalDataExport(data, { createFile, download })).resolves.toBe(
      'downloaded',
    );
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({ name: localDataExportFileName(options.exportedAt) }),
      localDataExportFileName(options.exportedAt),
    );
  });

  it('falls back to a download when a browser rejects the file-share capability check', async () => {
    const download = vi.fn();
    const createFile = (contents: string, fileName: string) =>
      new File([contents], fileName, { type: 'application/json' });
    const data = buildLocalDataExport(
      { workouts: [], sets: [], measurements: [], exercises: [], exercisePreferences: [] },
      options,
    );

    await expect(
      deliverLocalDataExport(data, {
        createFile,
        canShare: () => {
          throw new TypeError('Files are not supported');
        },
        share: vi.fn(),
        download,
      }),
    ).resolves.toBe('downloaded');
    expect(download).toHaveBeenCalledOnce();
  });

  it('does not download unexpectedly after the athlete cancels sharing', async () => {
    const download = vi.fn();
    const createFile = (contents: string, fileName: string) =>
      new File([contents], fileName, { type: 'application/json' });
    const data = buildLocalDataExport(
      { workouts: [], sets: [], measurements: [], exercises: [], exercisePreferences: [] },
      options,
    );

    await expect(
      deliverLocalDataExport(data, {
        createFile,
        canShare: () => true,
        share: vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')),
        download,
      }),
    ).resolves.toBe('cancelled');
    expect(download).not.toHaveBeenCalled();
  });
});
