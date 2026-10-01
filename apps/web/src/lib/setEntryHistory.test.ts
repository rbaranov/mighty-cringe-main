import { describe, expect, it } from 'vitest';
import type { LocalSet, LocalWorkout } from './db';
import { setEntryHistory } from './setEntryHistory';

const past = workout('2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z', 'past');
const current = workout('2026-09-03T10:00:00Z', null, 'current');
const priorSets = [
  set('p3', 'past', 'bench', 90, 6, { position: 5 }),
  set('p1', 'past', 'bench', 70, 10, { position: 0 }),
  set('p2', 'past', 'bench', 80, 8, { position: 2 }),
];

describe('set entry history', () => {
  it('matches first, second, third by visible order despite gaps and interleaved exercises', () => {
    const sets = [...priorSets, set('row', 'current', 'row', 20, 10)];
    for (const [index, expected] of [70, 80, 90].entries()) {
      const result = setEntryHistory(sets, [past, current], current, 'bench');
      expect(result.number).toBe(index + 1);
      expect(result.suggestion?.weightKg).toBe(expected);
      expect(result.previousSets.map((s) => s.weightKg)).toEqual([70, 80, 90]);
      sets.push(set(`c${index}`, 'current', 'bench', 100, 5, { position: index * 2 }));
    }
    expect(setEntryHistory(sets, [past, current], current, 'bench').suggestion?.weightKg).toBe(100);
  });

  it('skips empty sessions, deleted rows, active and future workouts', () => {
    const empty = workout('2026-09-02T10:00:00Z', '2026-09-02T11:00:00Z', 'empty');
    const future = workout('2026-09-04T10:00:00Z', '2026-09-04T11:00:00Z', 'future');
    const active = workout('2026-09-02T12:00:00Z', null, 'active');
    const result = setEntryHistory(
      [
        ...priorSets,
        set('deleted', 'current', 'bench', 30, 10, { deleted: true }),
        set('empty', 'empty', 'bench', 30, 10, { deleted: true }),
        set('future', 'future', 'bench', 30, 10),
        set('active', 'active', 'bench', 30, 10),
      ],
      [future, empty, active, current, past],
      current,
      'bench',
    );
    expect(result.number).toBe(1);
    expect(result.previousWorkout?.id).toBe('past');
    expect(result.suggestion?.weightKg).toBe(70);
  });

  it('uses the latest session containing the exercise and never mixes older sessions', () => {
    const recent = workout('2026-09-02T10:00:00Z', '2026-09-02T11:00:00Z', 'recent');
    const result = setEntryHistory(
      [...priorSets, set('r', 'recent', 'bench', 45, 15), set('c', 'current', 'bench', 50, 12)],
      [past, recent, current],
      current,
      'bench',
    );
    expect(result.number).toBe(2);
    expect(result.previousSets.map((s) => s.weightKg)).toEqual([45]);
    expect(result.suggestion?.weightKg).toBe(50);
    expect(result.useLatest).toBe(true);
  });

  it('uses the last entered result without past history, ignoring deleted and unrelated sets', () => {
    const result = setEntryHistory(
      [
        set('first', 'current', 'bench', 30, 12, {
          position: 4,
          performedAt: '2026-09-03T10:01:00Z',
        }),
        set('last', 'current', 'bench', 35, 10, {
          position: 0,
          performedAt: '2026-09-03T10:02:00Z',
          rir: 0,
        }),
        set('deleted', 'current', 'bench', 90, 2, { deleted: true }),
        set('other', 'current', 'row', 80, 5),
      ],
      [current],
      current,
      'bench',
    );
    expect(result.suggestion).toMatchObject({ id: 'last', weightKg: 35, reps: 10, rir: 0 });
    expect(result.useLatest).toBe(true);
    expect(result.previousSets).toEqual([]);
  });

  it('locates the edited ordinal and handles missing history', () => {
    const edited = set('c2', 'current', 'bench', 75, 6, { position: 9 });
    const result = setEntryHistory(
      [...priorSets, edited, set('c1', 'current', 'bench', 65, 8)],
      [past, current],
      current,
      'bench',
      edited,
    );
    expect(result.number).toBe(2);
    expect(result.suggestion?.weightKg).toBe(80);
    expect(setEntryHistory([], [current], current, 'bench').previousSets).toEqual([]);
    expect(setEntryHistory(priorSets, [past], undefined, undefined).suggestion).toBeNull();
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
