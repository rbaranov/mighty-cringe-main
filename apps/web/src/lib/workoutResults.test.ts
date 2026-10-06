import { describe, expect, it } from 'vitest';

import type { LocalSet, LocalWorkout } from './db';
import { buildPersonalRecords, buildWorkoutResult } from './workoutResults';

const old = workout('old', '2026-07-01T10:00:00.000Z');
const previous = workout('previous', '2026-07-04T10:00:00.000Z');
const current = workout('current', '2026-07-08T10:00:00.000Z');

describe('workout results', () => {
  it('compares each exercise with its latest earlier valid session, not just the last workout', () => {
    const unrelated = workout('unrelated', '2026-07-06T10:00:00.000Z');
    const result = buildWorkoutResult(
      current,
      [current, unrelated, old, previous],
      [
        set('old-bench', old, 'bench', 80, 15),
        set('previous-bench', previous, 'bench', 80, 8),
        set('unrelated-squat', unrelated, 'squat', 100, 8),
        set('current-bench', current, 'bench', 80, 10),
        set('current-squat', current, 'squat', 100, 9),
      ],
    )!;

    expect(result).toMatchObject({ setCount: 2, exerciseCount: 2, volumeKg: 1_700 });
    expect(result.exercises[0]).toMatchObject({
      exerciseId: 'bench',
      previous: { workoutId: previous.id, topWeightKg: 80 },
      repsComparisons: [{ weightKg: 80, previousReps: 8, reps: 10, delta: 2 }],
    });
    expect(result.exercises[1].previous?.workoutId).toBe(unrelated.id);
    // More reps than the last session is not an all-time best (15 reps in the older session).
    expect(result.achievements.filter((achievement) => achievement.exerciseId === 'bench')).toEqual(
      [],
    );
  });

  it('excludes later and simultaneous sessions when reviewing a historical workout', () => {
    const future = workout('future', '2026-07-20T10:00:00.000Z');
    const simultaneous = { ...current, id: 'same-start' };
    const result = buildWorkoutResult(
      current,
      [future, simultaneous, previous],
      [
        set('prior', previous, 'bench', 80, 8),
        set('now', current, 'bench', 85, 8),
        set('future', future, 'bench', 200, 20),
        set('simultaneous', simultaneous, 'bench', 200, 20),
      ],
    )!;

    expect(result.exercises[0].previous?.workoutId).toBe(previous.id);
    expect(result.achievements.map((achievement) => achievement.kind)).toEqual([
      'weight',
      'estimatedOneRepMax',
    ]);
    expect(result.achievements[0]).toMatchObject({ value: 85, previousValue: 80 });
  });

  it('keeps first observations as baselines and never celebrates unobserved weight rep records', () => {
    const first = set('first', current, 'bench', 80, 8);
    const result = buildWorkoutResult(current, [], [first])!;

    expect(result.exercises[0].previous).toBeNull();
    expect(result.achievements).toEqual([]);
    expect(buildPersonalRecords([current], [first])).toHaveLength(3);

    const changedWeight = buildWorkoutResult(
      current,
      [previous],
      [set('previous', previous, 'bench', 75, 8), first],
    )!;
    expect(changedWeight.exercises[0].repsComparisons).toEqual([]);
    expect(changedWeight.achievements.some((record) => record.kind === 'repsAtWeight')).toBe(false);
  });

  it('compares the best rep count at exactly the same weight and preserves both sources', () => {
    const result = buildWorkoutResult(
      current,
      [previous],
      [
        set('previous-low', previous, 'bench', 80, 7),
        set('previous-best', previous, 'bench', 80, 8),
        set('now-low', current, 'bench', 80, 9),
        set('now-best', current, 'bench', 80, 10),
        set('different-load', current, 'bench', 82.5, 12),
      ],
    )!;

    expect(result.exercises[0].repsComparisons).toEqual([
      expect.objectContaining({
        weightKg: 80,
        reps: 10,
        previousReps: 8,
        delta: 2,
        sourceSet: expect.objectContaining({ id: 'now-best' }),
        previousSourceSet: expect.objectContaining({ id: 'previous-best' }),
      }),
    ]);
    expect(result.achievements.find((record) => record.kind === 'repsAtWeight')).toMatchObject({
      value: 10,
      previousValue: 8,
      previousWorkoutId: previous.id,
      sourceSet: { id: 'now-best' },
      previousSourceSet: { id: 'previous-best' },
    });
  });

  it('tracks bodyweight repetitions without creating zero-kilogram weight or 1RM records', () => {
    const sets = [
      set('before', previous, 'push-up', 0, 10),
      set('after', current, 'push-up', 0, 12),
    ];
    const result = buildWorkoutResult(current, [previous], sets)!;

    expect(result).toMatchObject({ setCount: 1, exerciseCount: 1, volumeKg: 0 });
    expect(result.achievements).toEqual([
      expect.objectContaining({ kind: 'repsAtWeight', value: 12, previousValue: 10 }),
    ]);
    expect(buildPersonalRecords([current, previous], sets).map((record) => record.kind)).toEqual([
      'repsAtWeight',
    ]);
  });

  it('counts actual sets once even when the workout plan repeats an exercise', () => {
    const duplicatePlanWorkout = {
      ...current,
      exercises: [
        { id: 'first-entry', exerciseId: 'bench', position: 0, supersetGroup: null },
        { id: 'second-entry', exerciseId: 'bench', position: 1, supersetGroup: null },
      ],
    };
    const result = buildWorkoutResult(
      duplicatePlanWorkout,
      [],
      [set('one', current, 'bench', 80, 8), set('two', current, 'bench', 80, 7)],
    )!;

    expect(result).toMatchObject({ setCount: 2, exerciseCount: 1, volumeKg: 1_200 });
    expect(result.exercises).toHaveLength(1);
  });

  it('uses active duration and includes resumed sets whose real time is after the effective end', () => {
    const resumed = { ...current, durationSeconds: 2_700, syncState: 'pending' as const };
    const result = buildWorkoutResult(
      resumed,
      [previous],
      [
        set('before', previous, 'bench', 80, 8),
        set('resumed', resumed, 'bench', 85, 8, {
          performedAt: '2026-07-09T11:00:00.000Z',
          syncState: 'conflict',
        }),
      ],
    )!;

    expect(result).toMatchObject({ durationSeconds: 2_700, setCount: 1 });
    expect(result.achievements[0].sourceSet).toMatchObject({
      id: 'resumed',
      syncState: 'conflict',
    });
  });

  it('ignores incomplete, invalid, missing workouts and deleted sets', () => {
    const active = { ...old, id: 'active', endedAt: null };
    const invalid = { ...old, id: 'invalid', startedAt: 'invalid' };
    const backwards = { ...old, id: 'backwards', endedAt: '2026-06-01T10:00:00.000Z' };
    const sets = [
      set('deleted', current, 'bench', 100, 10, { deleted: true }),
      set('active', active, 'bench', 100, 10),
      set('invalid', invalid, 'bench', 100, 10, { performedAt: current.startedAt }),
      set('backwards', backwards, 'bench', 100, 10),
      set('orphan', { ...current, id: 'missing' }, 'bench', 100, 10),
      set('valid', current, 'bench', 80, 8),
    ];
    const workouts = [current, active, invalid, backwards];

    expect(buildWorkoutResult(current, workouts, sets)).toMatchObject({
      setCount: 1,
      volumeKg: 640,
      achievements: [],
    });
    expect(
      buildPersonalRecords(workouts, sets).every((record) => record.sourceSet.id === 'valid'),
    ).toBe(true);
    expect(buildWorkoutResult(active, workouts, sets)).toBeNull();
    expect(buildWorkoutResult(invalid, workouts, sets)).toBeNull();
    expect(buildWorkoutResult(backwards, workouts, sets)).toBeNull();
  });

  it.each<Partial<LocalSet>>([
    { weightKg: NaN },
    { weightKg: Infinity },
    { weightKg: -1 },
    { weightKg: 1_001 },
    { reps: 0 },
    { reps: 1.5 },
    { reps: 101 },
    { reps: Infinity },
    { rir: -1 },
    { rir: 1.5 },
    { rir: 21 },
    { rir: NaN },
    { performedAt: 'invalid' },
  ])('excludes invalid set fields %o from both the summary and records', (overrides) => {
    const invalid = set('invalid', current, 'bench', 80, 8, overrides);
    expect(buildWorkoutResult(current, [], [invalid])).toMatchObject({
      setCount: 0,
      exerciseCount: 0,
      volumeKg: 0,
      achievements: [],
    });
    expect(buildPersonalRecords([current], [invalid])).toEqual([]);
  });

  it('returns an honest empty result without counting plan entries as performed exercises', () => {
    expect(buildWorkoutResult(current, [previous], [])).toEqual({
      workoutId: current.id,
      durationSeconds: 3_600,
      setCount: 0,
      exerciseCount: 0,
      volumeKg: 0,
      exercises: [],
      achievements: [],
    });
  });
});

describe('source-backed personal records', () => {
  it('keeps separate sources for maximum weight, RIR-aware 1RM and reps at each weight', () => {
    const heaviest = set('heaviest', previous, 'bench', 100, 1, { rir: 0 });
    const strongestEstimate = set('estimated', current, 'bench', 90, 8, { rir: 2 });
    const records = buildPersonalRecords([current, previous], [heaviest, strongestEstimate]);

    expect(records.find((record) => record.kind === 'weight')).toMatchObject({
      value: 100,
      workoutId: previous.id,
      sourceSet: { id: 'heaviest' },
    });
    expect(records.find((record) => record.kind === 'estimatedOneRepMax')).toMatchObject({
      value: 120,
      workoutId: current.id,
      sourceSet: { id: 'estimated' },
    });
    expect(records.filter((record) => record.kind === 'repsAtWeight')).toHaveLength(2);
  });

  it('retains the first source for ties and does not turn repeated results into achievements', () => {
    const first = set('original', old, 'bench', 80, 8);
    const repeated = set('repeat', current, 'bench', 80, 8);
    const records = buildPersonalRecords([current, old], [repeated, first]);

    expect(records.every((record) => record.sourceSet.id === 'original')).toBe(true);
    expect(buildWorkoutResult(current, [old], [first, repeated])?.achievements).toEqual([]);
  });

  it('recomputes records and historical achievements after corrections or deletion', () => {
    const before = set('prior', previous, 'bench', 90, 8);
    const after = set('current', current, 'bench', 85, 8);
    const workouts = [previous, current];
    expect(buildWorkoutResult(current, workouts, [before, after])?.achievements).toEqual([]);

    const corrected = { ...before, weightKg: 80, syncState: 'pending' as const };
    expect(buildWorkoutResult(current, workouts, [corrected, after])?.achievements).toHaveLength(2);
    expect(
      buildPersonalRecords(workouts, [corrected, after]).find((record) => record.kind === 'weight')
        ?.sourceSet.id,
    ).toBe('current');

    const deleted = { ...corrected, deleted: true };
    expect(buildWorkoutResult(current, workouts, [deleted, after])?.achievements).toEqual([]);
  });
});

function workout(id: string, startedAt: string): LocalWorkout {
  const endedAt = new Date(Date.parse(startedAt) + 3_600_000).toISOString();
  return {
    id,
    startedAt,
    endedAt,
    durationSeconds: 3_600,
    activeSegmentStartedAt: null,
    lastActivityAt: endedAt,
    completionReason: 'manual',
    isFavorite: false,
    favoriteName: null,
    notes: null,
    locale: 'ru',
    revision: 1,
    updatedAt: endedAt,
    exercises: [],
    syncState: 'synced',
  };
}

function set(
  id: string,
  workout: LocalWorkout,
  exerciseId: string,
  weightKg: number,
  reps: number,
  overrides: Partial<LocalSet> = {},
): LocalSet {
  return {
    id,
    workoutId: workout.id,
    exerciseId,
    weightKg,
    reps,
    rir: null,
    comment: null,
    entrySource: 'manual',
    performedAt: workout.startedAt,
    position: 0,
    revision: 1,
    updatedAt: workout.startedAt,
    syncState: 'synced',
    deleted: false,
    ...overrides,
  };
}
