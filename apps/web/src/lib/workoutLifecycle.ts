import type { UpdateWorkoutInput } from '@mighty-cringe/contracts';

import type { LocalWorkout } from './db';

export const workoutWarningAfterMs = 105 * 60_000;
export const workoutAutoFinishAfterMs = 120 * 60_000;
export const workoutAutoFinishTailMs = 15 * 60_000;

export type WorkoutInactivityState =
  | { phase: 'active'; remainingSeconds: null }
  | { phase: 'warning'; remainingSeconds: number }
  | { phase: 'expired'; remainingSeconds: 0 };

export function workoutInactivityState(
  workout: Pick<LocalWorkout, 'endedAt' | 'lastActivityAt'>,
  now: number,
): WorkoutInactivityState {
  if (workout.endedAt !== null) return { phase: 'active', remainingSeconds: null };
  const inactivityMs = Math.max(0, now - new Date(workout.lastActivityAt).getTime());
  if (inactivityMs >= workoutAutoFinishAfterMs) {
    return { phase: 'expired', remainingSeconds: 0 };
  }
  if (inactivityMs >= workoutWarningAfterMs) {
    return {
      phase: 'warning',
      remainingSeconds: Math.max(1, Math.ceil((workoutAutoFinishAfterMs - inactivityMs) / 1_000)),
    };
  }
  return { phase: 'active', remainingSeconds: null };
}

export function displayedWorkoutDurationSeconds(
  workout: Pick<LocalWorkout, 'durationSeconds' | 'activeSegmentStartedAt' | 'endedAt'>,
  now: number,
) {
  if (workout.endedAt !== null || !workout.activeSegmentStartedAt) {
    return workout.durationSeconds;
  }
  return (
    workout.durationSeconds +
    Math.max(0, Math.floor((now - new Date(workout.activeSegmentStartedAt).getTime()) / 1_000))
  );
}

export function finishWorkoutChanges(
  workout: Pick<
    LocalWorkout,
    'startedAt' | 'durationSeconds' | 'activeSegmentStartedAt' | 'lastActivityAt'
  >,
  processedAt: string,
  reason: 'manual' | 'automatic',
): UpdateWorkoutInput['changes'] {
  const segmentStartedAt = new Date(workout.activeSegmentStartedAt ?? workout.startedAt).getTime();
  const processedAtMs = new Date(processedAt).getTime();
  const segmentEndedAt =
    reason === 'automatic'
      ? Math.min(
          processedAtMs,
          new Date(workout.lastActivityAt).getTime() + workoutAutoFinishTailMs,
        )
      : processedAtMs;
  const segmentSeconds = Math.max(
    0,
    Math.floor((Math.max(segmentStartedAt, segmentEndedAt) - segmentStartedAt) / 1_000),
  );
  const durationSeconds = workout.durationSeconds + segmentSeconds;
  const endedAt = new Date(
    new Date(workout.startedAt).getTime() + durationSeconds * 1_000,
  ).toISOString();

  return {
    endedAt,
    durationSeconds,
    activeSegmentStartedAt: null,
    lastActivityAt: reason === 'manual' ? processedAt : workout.lastActivityAt,
    completionReason: reason,
  };
}

export function resumeWorkoutChanges(resumedAt: string): UpdateWorkoutInput['changes'] {
  return {
    endedAt: null,
    activeSegmentStartedAt: resumedAt,
    lastActivityAt: resumedAt,
    completionReason: null,
  };
}

export function editWorkoutTimingChanges(
  startedAt: string,
  durationSeconds: number,
): UpdateWorkoutInput['changes'] {
  return {
    startedAt,
    endedAt: new Date(new Date(startedAt).getTime() + durationSeconds * 1_000).toISOString(),
    durationSeconds,
  };
}

export function formatWorkoutDurationSeconds(totalSeconds: number, locale: 'ru' | 'en') {
  const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return locale === 'en' ? `${minutes} min` : `${minutes} мин`;
  if (!minutes) return locale === 'en' ? `${hours} hr` : `${hours} ч`;
  return locale === 'en' ? `${hours} hr ${minutes} min` : `${hours} ч ${minutes} мин`;
}
