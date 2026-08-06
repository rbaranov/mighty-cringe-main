import 'fake-indexeddb/auto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, type LocalWorkout } from './db';
import { saveWorkoutNotes } from './workoutNotes';

describe('workout note persistence', () => {
  beforeEach(async () => {
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
    vi.stubGlobal('navigator', { onLine: false });
  });

  afterAll(async () => db.delete());

  it('saves an active workout note locally, marks activity, and queues sync while offline', async () => {
    const activeWorkout = {
      ...workout,
      endedAt: null,
      activeSegmentStartedAt: workout.startedAt,
    };
    await db.workouts.put(activeWorkout);

    await saveWorkoutNotes(activeWorkout, '  Тяжело спал, но разминка пошла хорошо.  ');

    const stored = await db.workouts.get(workout.id);
    expect(stored).toMatchObject({
      notes: 'Тяжело спал, но разминка пошла хорошо.',
      syncState: 'pending',
    });
    expect(stored!.lastActivityAt > activeWorkout.lastActivityAt).toBe(true);
    expect((await db.outbox.toArray())[0]?.mutation).toMatchObject({
      type: 'workout.update',
      payload: {
        workoutId: workout.id,
        baseRevision: workout.revision,
        changes: {
          notes: 'Тяжело спал, но разминка пошла хорошо.',
          lastActivityAt: stored!.lastActivityAt,
        },
      },
    });
  });

  it('edits and clears a completed workout note without changing its activity time', async () => {
    await db.workouts.put({ ...workout, notes: 'Старый комментарий' });

    await saveWorkoutNotes({ ...workout, notes: 'Старый комментарий' }, '   ');

    expect(await db.workouts.get(workout.id)).toMatchObject({
      notes: null,
      lastActivityAt: workout.lastActivityAt,
      syncState: 'pending',
    });
    expect((await db.outbox.toArray())[0]?.mutation).toMatchObject({
      type: 'workout.update',
      payload: { changes: { notes: null } },
    });
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
  notes: null,
  locale: 'ru',
  revision: 2,
  updatedAt: '2026-07-21T18:00:00.000Z',
  exercises: [],
  syncState: 'synced',
};
