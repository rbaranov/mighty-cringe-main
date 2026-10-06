import type { LocalSet, LocalWorkout } from './db';
import { estimateOneRepMax } from './progress';

export type RecordKind = 'weight' | 'estimatedOneRepMax' | 'repsAtWeight';

export type PersonalRecord = {
  kind: RecordKind;
  exerciseId: string;
  value: number;
  workoutId: string;
  startedAt: string;
  sourceSet: LocalSet;
};

export type WorkoutAchievement = PersonalRecord & {
  previousValue: number;
  previousSourceSet: LocalSet;
  previousWorkoutId: string;
};

export type ExercisePerformance = {
  workoutId: string;
  startedAt: string;
  exerciseId: string;
  setCount: number;
  volumeKg: number;
  topWeightKg: number;
  estimatedOneRepMaxKg: number;
  topWeightSet: LocalSet;
  estimatedOneRepMaxSet: LocalSet;
};

export type RepsComparison = {
  weightKg: number;
  reps: number;
  previousReps: number;
  delta: number;
  sourceSet: LocalSet;
  previousSourceSet: LocalSet;
};

export type WorkoutExerciseResult = ExercisePerformance & {
  previous: ExercisePerformance | null;
  repsComparisons: RepsComparison[];
};

export type WorkoutResult = {
  workoutId: string;
  durationSeconds: number;
  setCount: number;
  exerciseCount: number;
  volumeKg: number;
  exercises: WorkoutExerciseResult[];
  achievements: WorkoutAchievement[];
};

// These are the numeric contract boundaries, applied to locally stored data too.
export function isValidResultSet(set: LocalSet): boolean {
  return (
    !set.deleted &&
    Number.isFinite(set.weightKg) &&
    set.weightKg >= 0 &&
    set.weightKg <= 1_000 &&
    Number.isInteger(set.reps) &&
    set.reps >= 1 &&
    set.reps <= 100 &&
    (set.rir === null || (Number.isInteger(set.rir) && set.rir >= 0 && set.rir <= 20)) &&
    Number.isFinite(Date.parse(set.performedAt))
  );
}

export function isCompletedResultWorkout(workout: LocalWorkout): boolean {
  const startedAt = Date.parse(workout.startedAt);
  const endedAt = workout.endedAt === null ? NaN : Date.parse(workout.endedAt);
  return (
    Number.isFinite(startedAt) &&
    Number.isFinite(endedAt) &&
    endedAt >= startedAt &&
    Number.isInteger(workout.durationSeconds) &&
    workout.durationSeconds >= 0
  );
}

/** Recomputable source-backed bests. Zero-load exercises have rep records only. */
export function buildPersonalRecords(workouts: LocalWorkout[], sets: LocalSet[]): PersonalRecord[] {
  const completed = orderedWorkouts(workouts);
  const records = new Map<string, PersonalRecord>();
  const setsByWorkout = eligibleSetsByWorkout(completed, sets);

  for (const workout of completed) {
    for (const set of setsByWorkout.get(workout.id) ?? []) {
      const candidates: Array<[RecordKind, number]> = [['repsAtWeight', set.reps]];
      if (set.weightKg > 0) {
        candidates.unshift(
          ['weight', set.weightKg],
          ['estimatedOneRepMax', estimateOneRepMax(set)],
        );
      }
      for (const [kind, value] of candidates) {
        const record: PersonalRecord = {
          kind,
          exerciseId: set.exerciseId,
          value,
          workoutId: workout.id,
          startedAt: workout.startedAt,
          sourceSet: set,
        };
        const key = recordKey(record);
        const previous = records.get(key);
        // Equal values keep the original source, independently of input array order.
        if (!previous || improves(value, previous.value)) records.set(key, record);
      }
    }
  }

  return [...records.values()];
}

/** Compare a session only with earlier sessions, including when reopening history. */
export function buildWorkoutResult(
  workout: LocalWorkout,
  workouts: LocalWorkout[],
  sets: LocalSet[],
): WorkoutResult | null {
  if (!isCompletedResultWorkout(workout)) return null;
  const startedAt = Date.parse(workout.startedAt);
  const previousWorkouts = orderedWorkouts(workouts).filter(
    (candidate) => candidate.id !== workout.id && Date.parse(candidate.startedAt) < startedAt,
  );
  const setsByWorkout = eligibleSetsByWorkout([...previousWorkouts, workout], sets);
  const currentSets = setsByWorkout.get(workout.id) ?? [];
  const currentByExercise = groupByExercise(currentSets);
  const previousByExercise = new Map<
    string,
    { performance: ExercisePerformance; sets: LocalSet[] }
  >();

  for (const previous of previousWorkouts) {
    for (const [exerciseId, exerciseSets] of groupByExercise(
      setsByWorkout.get(previous.id) ?? [],
    )) {
      previousByExercise.set(exerciseId, {
        performance: exercisePerformance(previous, exerciseId, exerciseSets),
        sets: exerciseSets,
      });
    }
  }

  const exercises = [...currentByExercise].map(([exerciseId, exerciseSets]) => {
    const previous = previousByExercise.get(exerciseId);
    const previousReps = bestRepsByWeight(previous?.sets ?? []);
    const repsComparisons = [...bestRepsByWeight(exerciseSets)]
      .flatMap(([weightKg, sourceSet]): RepsComparison[] => {
        const previousSourceSet = previousReps.get(weightKg);
        return previousSourceSet
          ? [
              {
                weightKg,
                reps: sourceSet.reps,
                previousReps: previousSourceSet.reps,
                delta: sourceSet.reps - previousSourceSet.reps,
                sourceSet,
                previousSourceSet,
              },
            ]
          : [];
      })
      .sort((left, right) => right.delta - left.delta || right.weightKg - left.weightKg);
    return {
      ...exercisePerformance(workout, exerciseId, exerciseSets),
      previous: previous?.performance ?? null,
      repsComparisons,
    };
  });

  const previousRecords = new Map(
    buildPersonalRecords(previousWorkouts, sets).map((record) => [recordKey(record), record]),
  );
  const achievements = buildPersonalRecords([workout], currentSets).flatMap(
    (record): WorkoutAchievement[] => {
      const previous = previousRecords.get(recordKey(record));
      // A first observation is a useful baseline, not a broken personal record.
      if (!previous || !improves(record.value, previous.value)) return [];
      return [
        {
          ...record,
          previousValue: previous.value,
          previousSourceSet: previous.sourceSet,
          previousWorkoutId: previous.workoutId,
        },
      ];
    },
  );

  return {
    workoutId: workout.id,
    durationSeconds: workout.durationSeconds,
    setCount: currentSets.length,
    exerciseCount: currentByExercise.size,
    volumeKg: currentSets.reduce((total, set) => total + set.weightKg * set.reps, 0),
    exercises,
    achievements,
  };
}

function orderedWorkouts(workouts: LocalWorkout[]): LocalWorkout[] {
  return workouts
    .filter(isCompletedResultWorkout)
    .sort(
      (left, right) =>
        Date.parse(left.startedAt) - Date.parse(right.startedAt) || left.id.localeCompare(right.id),
    );
}

function eligibleSetsByWorkout(
  workouts: LocalWorkout[],
  sets: LocalSet[],
): Map<string, LocalSet[]> {
  const workoutIds = new Set(workouts.map((workout) => workout.id));
  const grouped = new Map<string, LocalSet[]>();
  for (const set of sets.filter(isValidResultSet).sort(compareSets)) {
    if (!workoutIds.has(set.workoutId)) continue;
    const rows = grouped.get(set.workoutId) ?? [];
    rows.push(set);
    grouped.set(set.workoutId, rows);
  }
  return grouped;
}

function groupByExercise(sets: LocalSet[]): Map<string, LocalSet[]> {
  const grouped = new Map<string, LocalSet[]>();
  for (const set of sets) {
    const rows = grouped.get(set.exerciseId) ?? [];
    rows.push(set);
    grouped.set(set.exerciseId, rows);
  }
  return grouped;
}

function exercisePerformance(
  workout: LocalWorkout,
  exerciseId: string,
  sets: LocalSet[],
): ExercisePerformance {
  const topWeightSet = sets.reduce((best, set) =>
    improves(set.weightKg, best.weightKg) ? set : best,
  );
  const estimatedOneRepMaxSet = sets.reduce((best, set) =>
    improves(estimateOneRepMax(set), estimateOneRepMax(best)) ? set : best,
  );
  return {
    workoutId: workout.id,
    startedAt: workout.startedAt,
    exerciseId,
    setCount: sets.length,
    volumeKg: sets.reduce((total, set) => total + set.weightKg * set.reps, 0),
    topWeightKg: topWeightSet.weightKg,
    estimatedOneRepMaxKg: estimateOneRepMax(estimatedOneRepMaxSet),
    topWeightSet,
    estimatedOneRepMaxSet,
  };
}

function bestRepsByWeight(sets: LocalSet[]): Map<number, LocalSet> {
  const grouped = new Map<number, LocalSet>();
  for (const set of sets) {
    const best = grouped.get(set.weightKg);
    if (!best || set.reps > best.reps) grouped.set(set.weightKg, set);
  }
  return grouped;
}

function recordKey(record: PersonalRecord): string {
  return `${record.exerciseId}:${record.kind}${record.kind === 'repsAtWeight' ? `:${record.sourceSet.weightKg}` : ''}`;
}

function compareSets(left: LocalSet, right: LocalSet): number {
  return (
    Date.parse(left.performedAt) - Date.parse(right.performedAt) ||
    left.position - right.position ||
    left.id.localeCompare(right.id)
  );
}

function improves(current: number, previous: number): boolean {
  return current - previous > 1e-9;
}
