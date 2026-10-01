import type { LocalSet, LocalWorkout } from './db';

// Match the visible ordinal, not the stored position (deletions can leave gaps).
export function setEntryHistory(
  sets: LocalSet[],
  workouts: LocalWorkout[],
  workout: LocalWorkout | undefined,
  exerciseId: string | undefined,
  editing: LocalSet | null = null,
) {
  const candidates = sets.filter((set) => !set.deleted && set.exerciseId === exerciseId);
  const ordered = (rows: LocalSet[]) =>
    rows.sort(
      (a, b) =>
        a.position - b.position ||
        a.performedAt.localeCompare(b.performedAt) ||
        a.id.localeCompare(b.id),
    );
  const current = ordered(candidates.filter((set) => set.workoutId === workout?.id));
  const ordinal = editing
    ? Math.max(
        0,
        current.findIndex((set) => set.id === editing.id),
      )
    : current.length;
  const previousWorkout = workout
    ? workouts
        .filter(
          (item) =>
            item.id !== workout.id &&
            item.endedAt !== null &&
            new Date(item.startedAt).getTime() < new Date(workout.startedAt).getTime() &&
            candidates.some((set) => set.workoutId === item.id),
        )
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0]
    : undefined;
  const previousSets = previousWorkout
    ? ordered(candidates.filter((set) => set.workoutId === previousWorkout.id))
    : [];
  const matching = previousSets[ordinal] ?? null;
  const latest = (rows: LocalSet[]) =>
    [...rows]
      .filter((set) => set.id !== editing?.id)
      .sort((a, b) => b.performedAt.localeCompare(a.performedAt) || b.position - a.position)[0] ??
    null;
  const fallback = latest(current) ?? latest(previousSets);
  return {
    number: ordinal + 1,
    previousWorkout,
    previousSets,
    suggestion: matching ?? fallback,
    useLatest: !matching && fallback !== null,
  };
}
