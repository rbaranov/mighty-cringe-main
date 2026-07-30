import { describe, expect, it } from 'vitest';

import type { LocalWorkout } from './db';
import {
  displayedWorkoutDurationSeconds,
  editWorkoutTimingChanges,
  finishWorkoutChanges,
  formatWorkoutDurationSeconds,
  resumeWorkoutChanges,
  workoutInactivityState,
} from './workoutLifecycle';

describe('workout lifecycle', () => {
  it('warns after 1h45 and expires after 2h', () => {
    const workout = activeWorkout();
    const started = new Date(workout.lastActivityAt).getTime();
    expect(workoutInactivityState(workout, started + 104 * 60_000).phase).toBe('active');
    expect(workoutInactivityState(workout, started + 105 * 60_000)).toEqual({
      phase: 'warning',
      remainingSeconds: 900,
    });
    expect(workoutInactivityState(workout, started + 120 * 60_000)).toEqual({
      phase: 'expired',
      remainingSeconds: 0,
    });
  });

  it('auto-finishes at the last activity plus fifteen minutes', () => {
    const workout = activeWorkout({
      lastActivityAt: '2026-07-30T10:45:00.000Z',
    });
    expect(finishWorkoutChanges(workout, '2026-07-30T12:45:00.000Z', 'automatic')).toEqual({
      endedAt: '2026-07-30T11:00:00.000Z',
      durationSeconds: 3600,
      activeSegmentStartedAt: null,
      lastActivityAt: '2026-07-30T10:45:00.000Z',
      completionReason: 'automatic',
    });
  });

  it('adds a resumed segment without counting the gap', () => {
    const completed = activeWorkout({
      endedAt: '2026-07-30T11:00:00.000Z',
      durationSeconds: 3600,
      activeSegmentStartedAt: null,
      completionReason: 'automatic',
    });
    const resumedAt = '2026-07-31T10:00:00.000Z';
    const resumed = { ...completed, ...resumeWorkoutChanges(resumedAt) };
    expect(displayedWorkoutDurationSeconds(resumed, Date.parse('2026-07-31T10:30:00.000Z'))).toBe(
      5400,
    );
    expect(finishWorkoutChanges(resumed, '2026-07-31T10:30:00.000Z', 'manual')).toMatchObject({
      endedAt: '2026-07-30T11:30:00.000Z',
      durationSeconds: 5400,
      completionReason: 'manual',
    });
  });

  it('recomputes the effective end when timing is corrected', () => {
    expect(editWorkoutTimingChanges('2026-07-29T18:00:00.000Z', 5_400)).toEqual({
      startedAt: '2026-07-29T18:00:00.000Z',
      endedAt: '2026-07-29T19:30:00.000Z',
      durationSeconds: 5_400,
    });
  });

  it('shows the same nearest minute that the timing editor opens with', () => {
    expect(formatWorkoutDurationSeconds(17_159, 'ru')).toBe('4 ч 46 мин');
    expect(formatWorkoutDurationSeconds(17_159, 'en')).toBe('4 hr 46 min');
  });
});

function activeWorkout(overrides: Partial<LocalWorkout> = {}): LocalWorkout {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    startedAt: '2026-07-30T10:00:00.000Z',
    endedAt: null,
    durationSeconds: 0,
    activeSegmentStartedAt: '2026-07-30T10:00:00.000Z',
    lastActivityAt: '2026-07-30T10:00:00.000Z',
    completionReason: null,
    notes: null,
    locale: 'ru',
    revision: 1,
    updatedAt: '2026-07-30T10:00:00.000Z',
    exercises: [],
    syncState: 'synced',
    ...overrides,
  };
}
