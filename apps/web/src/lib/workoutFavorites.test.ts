import 'fake-indexeddb/auto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, type LocalWorkout } from './db';
import { normalizeWorkoutFavoriteName, saveWorkoutFavorite } from './workoutFavorites';

describe('favorite workout persistence', () => {
  beforeEach(async () => {
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
    vi.stubGlobal('navigator', { onLine: false });
  });

  afterAll(async () => db.delete());

  it('keeps the bookmark locally and queues it while offline', async () => {
    await db.workouts.put(workout);

    await saveWorkoutFavorite(workout, true, '  Тяжёлая грудь  ');

    expect(await db.workouts.get(workout.id)).toMatchObject({
      isFavorite: true,
      favoriteName: 'Тяжёлая грудь',
      syncState: 'pending',
    });
    expect((await db.outbox.toArray())[0]?.mutation).toMatchObject({
      type: 'workout.update',
      payload: {
        workoutId: workout.id,
        baseRevision: workout.revision,
        changes: { isFavorite: true, favoriteName: 'Тяжёлая грудь' },
      },
    });
  });

  it('retains the name when a favorite is removed and added again', async () => {
    const namedWorkout = { ...workout, isFavorite: true, favoriteName: 'Ноги' };
    await db.workouts.put(namedWorkout);

    await saveWorkoutFavorite(namedWorkout, false);
    const removed = await db.workouts.get(workout.id);
    expect(removed).toMatchObject({ isFavorite: false, favoriteName: 'Ноги' });

    await saveWorkoutFavorite(removed!, true);
    expect(await db.workouts.get(workout.id)).toMatchObject({
      isFavorite: true,
      favoriteName: 'Ноги',
    });
  });

  it('normalizes blank and padded names', () => {
    expect(normalizeWorkoutFavoriteName('   ')).toBeNull();
    expect(normalizeWorkoutFavoriteName('  Спина и бицепс  ')).toBe('Спина и бицепс');
  });

  it('does not bookmark an unfinished workout', async () => {
    const unfinished = { ...workout, endedAt: null, activeSegmentStartedAt: workout.startedAt };
    await db.workouts.put(unfinished);

    await saveWorkoutFavorite(unfinished, true);

    expect((await db.workouts.get(workout.id))?.isFavorite).toBe(false);
    expect(await db.outbox.count()).toBe(0);
  });
});

const workout: LocalWorkout = {
  id: '20000000-0000-4000-8000-000000000001',
  startedAt: '2026-07-21T17:00:00.000Z',
  endedAt: '2026-07-21T18:00:00.000Z',
  durationSeconds: 3_600,
  activeSegmentStartedAt: null,
  lastActivityAt: '2026-07-21T18:00:00.000Z',
  completionReason: 'manual',
  isFavorite: false,
  favoriteName: null,
  notes: null,
  locale: 'ru',
  revision: 2,
  updatedAt: '2026-07-21T18:00:00.000Z',
  exercises: [],
  syncState: 'synced',
};
