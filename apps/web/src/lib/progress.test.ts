import { describe, expect, it } from 'vitest';

import type { LocalSet, LocalWorkout } from './db';
import {
  buildCalendarMonth,
  buildExerciseProgress,
  buildWorkoutDays,
  calculateWeeklyStreaks,
  estimateOneRepMax,
  hasWorkoutInCurrentWeek,
  volumeForPreviousDays,
  volumeForRecentDays,
  workoutCountForMonth,
  workoutCountForYear,
} from './progress';

const firstWorkout = workout('2026-07-20T18:00:00.000Z', '2026-07-20T19:00:00.000Z', 'w1');
const secondWorkout = workout('2026-07-21T18:00:00.000Z', '2026-07-21T19:00:00.000Z', 'w2');

describe('progress metrics', () => {
  it('calculates an RIR-aware Epley estimate', () => {
    expect(estimateOneRepMax({ weightKg: 80, reps: 8, rir: 2 })).toBeCloseTo(106.67, 2);
    expect(estimateOneRepMax({ weightKg: 80, reps: 8, rir: null })).toBeCloseTo(101.33, 2);
  });

  it('aggregates completed workouts in the user timezone and ignores deleted sets', () => {
    const activeWorkout = workout('2026-07-22T18:00:00.000Z', null, 'w3');
    const days = buildWorkoutDays(
      [firstWorkout, secondWorkout, activeWorkout],
      [
        set('s1', 'w1', 'bench', 80, 5),
        set('s2', 'w1', 'bench', 70, 8, { deleted: true }),
        set('s3', 'w2', 'bench', 82.5, 5),
        set('s4', 'w3', 'bench', 90, 3),
      ],
      'UTC',
    );

    expect(days).toEqual([
      expect.objectContaining({ dateKey: '2026-07-20', setCount: 1, volumeKg: 400 }),
      expect.objectContaining({ dateKey: '2026-07-21', setCount: 1, volumeKg: 412.5 }),
    ]);
    expect(volumeForRecentDays(days, '2026-07-22', 3)).toBe(812.5);
    expect(workoutCountForMonth(days, '2026-07')).toBe(2);
    expect(workoutCountForYear(days, '2026')).toBe(2);
  });

  it('compares the latest day window with the immediately preceding window', () => {
    const juneWorkout = workout('2026-06-15T18:00:00.000Z', '2026-06-15T19:00:00.000Z', 'june');
    const julyWorkout = workout('2026-07-15T18:00:00.000Z', '2026-07-15T19:00:00.000Z', 'july');
    const days = buildWorkoutDays(
      [juneWorkout, julyWorkout],
      [set('june-set', 'june', 'bench', 50, 10), set('july-set', 'july', 'bench', 60, 10)],
      'UTC',
    );

    expect(volumeForRecentDays(days, '2026-07-30')).toBe(600);
    expect(volumeForPreviousDays(days, '2026-07-30')).toBe(500);
  });

  it('places a late workout on its local calendar day', () => {
    const lateWorkout = workout('2026-07-20T20:00:00.000Z', '2026-07-20T20:30:00.000Z', 'late');
    expect(buildWorkoutDays([lateWorkout], [], 'Asia/Almaty')[0].dateKey).toBe('2026-07-21');
  });

  it('keeps a workout on its start day when its effective end crosses midnight', () => {
    const overnight = workout('2026-07-20T23:40:00.000Z', '2026-07-21T00:20:00.000Z', 'overnight');
    const days = buildWorkoutDays(
      [overnight],
      [set('overnight-set', overnight.id, 'bench', 60, 8)],
      'UTC',
    );
    expect(days[0]).toMatchObject({ dateKey: '2026-07-20', workoutCount: 1 });
  });

  it('keeps an empty workout in history without counting it as training', () => {
    const empty = workout('2026-07-22T10:00:00.000Z', '2026-07-22T10:15:00.000Z', 'empty');
    const days = buildWorkoutDays([firstWorkout, empty], [set('s1', 'w1', 'bench', 80, 5)], 'UTC');
    expect(days.find((day) => day.dateKey === '2026-07-22')).toMatchObject({
      workoutIds: ['empty'],
      workoutCount: 0,
      setCount: 0,
      volumeKg: 0,
    });
    expect(workoutCountForMonth(days, '2026-07')).toBe(1);
  });

  it('counts the unfinished current week as soon as it has a completed workout', () => {
    const workoutDays = ['2026-07-20', '2026-07-28'];

    expect(calculateWeeklyStreaks(workoutDays, '2026-07-28')).toEqual({
      current: 2,
      best: 2,
    });
    expect(hasWorkoutInCurrentWeek(workoutDays, '2026-07-28')).toBe(true);
  });

  it('keeps the previous streak available until the current week ends', () => {
    expect(
      calculateWeeklyStreaks(
        ['2026-06-30', '2026-07-07', '2026-07-14', '2026-07-25'],
        '2026-07-27',
      ),
    ).toEqual({ current: 4, best: 4 });
    expect(
      hasWorkoutInCurrentWeek(
        ['2026-06-30', '2026-07-07', '2026-07-14', '2026-07-25'],
        '2026-07-27',
      ),
    ).toBe(false);
    expect(calculateWeeklyStreaks(['2026-07-01'], '2026-07-20')).toEqual({
      current: 0,
      best: 1,
    });
  });

  it('builds one comparable strength point per workout with its source set', () => {
    const points = buildExerciseProgress(
      'bench',
      [firstWorkout, secondWorkout],
      [
        set('s1', 'w1', 'bench', 80, 8, { rir: 2 }),
        set('s2', 'w1', 'bench', 90, 3, { rir: 0 }),
        set('s3', 'w2', 'bench', 82.5, 8, { rir: 1 }),
        set('s4', 'w2', 'squat', 120, 5),
      ],
      'UTC',
    );

    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      topWeightKg: 90,
      volumeKg: 910,
      sourceSet: { id: 's1' },
    });
    expect(points[0].estimatedOneRepMaxKg).toBeCloseTo(106.67, 2);
    expect(points[1]).toMatchObject({ topWeightKg: 82.5, setCount: 1 });
  });

  it('creates a Monday-first six-week calendar grid', () => {
    const cells = buildCalendarMonth('2026-07', [], '2026-07-22');
    expect(cells).toHaveLength(42);
    expect(cells[0].dateKey).toBe('2026-06-29');
    expect(cells.find((cell) => cell.dateKey === '2026-07-22')).toMatchObject({
      isToday: true,
      inMonth: true,
    });
  });
});

function workout(startedAt: string, endedAt: string | null, id: string): LocalWorkout {
  return {
    id,
    startedAt,
    endedAt,
    durationSeconds: endedAt
      ? Math.max(
          0,
          Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
        )
      : 0,
    activeSegmentStartedAt: endedAt ? null : startedAt,
    lastActivityAt: endedAt ?? startedAt,
    completionReason: endedAt ? 'manual' : null,
    isFavorite: false,
    favoriteName: null,
    notes: null,
    locale: 'ru',
    revision: 1,
    updatedAt: endedAt ?? startedAt,
    exercises: [],
    syncState: 'synced',
  };
}

function set(
  id: string,
  workoutId: string,
  exerciseId: string,
  weightKg: number,
  reps: number,
  overrides: Partial<LocalSet> = {},
): LocalSet {
  return {
    id,
    workoutId,
    exerciseId,
    weightKg,
    reps,
    rir: null,
    comment: null,
    entrySource: 'manual',
    performedAt: '2026-07-20T18:30:00.000Z',
    position: 0,
    revision: 1,
    updatedAt: '2026-07-20T18:30:00.000Z',
    syncState: 'synced',
    deleted: false,
    ...overrides,
  };
}
