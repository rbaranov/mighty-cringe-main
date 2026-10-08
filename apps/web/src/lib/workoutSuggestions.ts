import type { Exercise, ExercisePreferenceValue, WorkoutExercise } from '@mighty-cringe/contracts';

type WorkoutHistoryItem = {
  id: string;
  endedAt: string | null;
  exercises: readonly WorkoutExercise[];
  isFavorite?: boolean;
};

type PerformedSet = {
  workoutId: string;
  exerciseId: string;
  deleted?: boolean;
};

const rotationMuscles: Exercise['primaryMuscles'][number][] = [
  'back',
  'middle_delt',
  'chest',
  'biceps',
  'quadriceps',
  'triceps',
];

export function buildSuggestedExercises({
  catalog,
  workouts,
  sets = [],
  today = new Date(),
  preferences = new Map(),
  seed,
  previousExerciseIds = [],
}: {
  catalog: readonly Exercise[];
  workouts: readonly WorkoutHistoryItem[];
  sets?: readonly PerformedSet[];
  today?: Date;
  preferences?: ReadonlyMap<string, ExercisePreferenceValue | null | undefined>;
  seed?: string;
  previousExerciseIds?: readonly string[];
}) {
  const recommendableCatalog = [
    ...new Map(
      catalog
        .filter((exercise) => preferences.get(exercise.id) !== 'dislike')
        .map((exercise) => [exercise.id, exercise]),
    ).values(),
  ];
  const completed = workouts
    .filter((workout) => workout.endedAt !== null)
    .sort(
      (left, right) =>
        (right.endedAt ?? '').localeCompare(left.endedAt ?? '') || left.id.localeCompare(right.id),
    );
  const completedIds = new Set(completed.map((workout) => workout.id));
  const performedWorkouts = new Map<string, Set<string>>();
  for (const set of sets) {
    if (set.deleted || !completedIds.has(set.workoutId)) continue;
    const workoutIds = performedWorkouts.get(set.exerciseId) ?? new Set<string>();
    workoutIds.add(set.workoutId);
    performedWorkouts.set(set.exerciseId, workoutIds);
  }

  const favoriteCounts = new Map<string, number>();
  for (const workout of workouts) {
    if (!workout.isFavorite) continue;
    for (const exerciseId of new Set(workout.exercises.map((exercise) => exercise.exerciseId))) {
      favoriteCounts.set(exerciseId, (favoriteCounts.get(exerciseId) ?? 0) + 1);
    }
  }

  const selectionSeed =
    seed ??
    `${localDateKey(today)}:${completed
      .slice(0, 8)
      .map((workout) => workout.id)
      .join(':')}`;
  const scores = new Map(
    recommendableCatalog.map((exercise) => {
      const frequency = performedWorkouts.get(exercise.id)?.size ?? 0;
      const favorites = favoriteCounts.get(exercise.id) ?? 0;
      // Familiar movements have better odds, but every allowed exercise remains eligible.
      const weight =
        1 +
        Math.min(12, 3 * Math.sqrt(frequency)) +
        Math.min(8, 4 * Math.sqrt(favorites)) +
        (preferences.get(exercise.id) === 'like' ? 6 : 0);
      const random = (stableScore(`${selectionSeed}:${exercise.id}`) + 1) / 4_294_967_297;
      return [exercise.id, -Math.log(random) / weight] as const;
    }),
  );
  const ranked = recommendableCatalog.sort(
    (left, right) =>
      scores.get(left.id)! - scores.get(right.id)! || left.id.localeCompare(right.id),
  );
  const candidatesByMuscle = rotationMuscles.map((muscle) =>
    ranked.filter((exercise) => exercise.primaryMuscles.includes(muscle)),
  );

  // Reassign overlapping movements when needed so one exercise cannot block another muscle slot.
  const slotsByExercise = new Map<string, number>();
  const assignMuscle = (slot: number, visited: Set<string>): boolean => {
    for (const exercise of candidatesByMuscle[slot]!) {
      if (visited.has(exercise.id)) continue;
      visited.add(exercise.id);
      const previousSlot = slotsByExercise.get(exercise.id);
      if (previousSlot === undefined || assignMuscle(previousSlot, visited)) {
        slotsByExercise.set(exercise.id, slot);
        return true;
      }
    }
    return false;
  };
  rotationMuscles.forEach((_, slot) => assignMuscle(slot, new Set()));

  const selected = ranked
    .filter((exercise) => slotsByExercise.has(exercise.id))
    .sort((left, right) => slotsByExercise.get(left.id)! - slotsByExercise.get(right.id)!);
  const selectedIds = new Set(selected.map((exercise) => exercise.id));
  for (const exercise of ranked) {
    if (selected.length === rotationMuscles.length) break;
    if (selectedIds.has(exercise.id)) continue;
    selected.push(exercise);
    selectedIds.add(exercise.id);
  }

  const previousIds = new Set(previousExerciseIds);
  if (
    selected.length === previousIds.size &&
    selected.every((exercise) => previousIds.has(exercise.id))
  ) {
    // A reroll changes membership when alternatives exist, keeping as much muscle coverage as possible.
    const alternatives = ranked.filter((exercise) => !selectedIds.has(exercise.id));
    let bestSwap:
      { index: number; exercise: Exercise; coverage: number; score: number } | undefined;
    for (const exercise of alternatives) {
      selected.forEach((current, index) => {
        const muscles = new Set(
          selected.flatMap((item, itemIndex) =>
            itemIndex === index ? exercise.primaryMuscles : item.primaryMuscles,
          ),
        );
        const coverage = rotationMuscles.filter((muscle) => muscles.has(muscle)).length;
        const score = scores.get(exercise.id)! - scores.get(current.id)!;
        if (
          !bestSwap ||
          coverage > bestSwap.coverage ||
          (coverage === bestSwap.coverage && score < bestSwap.score)
        ) {
          bestSwap = { index, exercise, coverage, score };
        }
      });
    }
    if (bestSwap) selected[bestSwap.index] = bestSwap.exercise;
  }

  return selected;
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function stableScore(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  // Avalanche the hash so similar exercise IDs and successive seeds do not share a ranking.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}
