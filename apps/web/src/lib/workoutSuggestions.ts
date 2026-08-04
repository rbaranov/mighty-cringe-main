import type { Exercise, ExercisePreferenceValue, WorkoutExercise } from '@mighty-cringe/contracts';

type WorkoutHistoryItem = {
  id: string;
  endedAt: string | null;
  exercises: WorkoutExercise[];
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
  today = new Date(),
  preferences = new Map(),
}: {
  catalog: Exercise[];
  workouts: WorkoutHistoryItem[];
  today?: Date;
  preferences?: ReadonlyMap<string, ExercisePreferenceValue | null | undefined>;
}) {
  const recommendableCatalog = catalog.filter(
    (exercise) => preferences.get(exercise.id) !== 'dislike',
  );
  const completed = workouts
    .filter((workout) => workout.endedAt !== null)
    .sort((left, right) => (right.endedAt ?? '').localeCompare(left.endedAt ?? ''));
  const lastUsed = new Map<string, number>();
  completed.forEach((workout, workoutIndex) => {
    for (const item of workout.exercises) {
      if (!lastUsed.has(item.exerciseId)) lastUsed.set(item.exerciseId, workoutIndex);
    }
  });

  const seed = `${localDateKey(today)}:${completed
    .slice(0, 8)
    .map((workout) => workout.id)
    .join(':')}`;
  const selected: Exercise[] = [];
  const selectedIds = new Set<string>();

  for (const muscle of rotationMuscles) {
    const choice = recommendableCatalog
      .filter(
        (exercise) => !selectedIds.has(exercise.id) && exercise.primaryMuscles.includes(muscle),
      )
      .sort((left, right) => compareRotation(left, right, lastUsed, seed))[0];
    if (!choice) continue;
    selected.push(choice);
    selectedIds.add(choice.id);
  }

  if (selected.length < rotationMuscles.length) {
    const remaining = recommendableCatalog
      .filter((exercise) => !selectedIds.has(exercise.id))
      .sort((left, right) => compareRotation(left, right, lastUsed, seed));
    for (const exercise of remaining) {
      selected.push(exercise);
      if (selected.length === rotationMuscles.length) break;
    }
  }

  return selected;
}

function compareRotation(
  left: Exercise,
  right: Exercise,
  lastUsed: Map<string, number>,
  seed: string,
) {
  const leftRecency = lastUsed.get(left.id) ?? Number.POSITIVE_INFINITY;
  const rightRecency = lastUsed.get(right.id) ?? Number.POSITIVE_INFINITY;
  if (leftRecency !== rightRecency) return rightRecency - leftRecency;
  return stableScore(`${seed}:${left.id}`) - stableScore(`${seed}:${right.id}`);
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
  return hash >>> 0;
}
