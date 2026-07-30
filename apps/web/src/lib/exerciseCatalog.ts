import { muscleGroups, type Exercise } from '@mighty-cringe/contracts';

export type ExerciseCatalogFilters = {
  query: string;
  muscle: Exercise['primaryMuscles'][number] | 'all';
  tag: Exercise['tag'] | 'all';
};

export type ExerciseChoiceGroup = {
  muscle: Exercise['primaryMuscles'][number];
  exercises: Exercise[];
};

export function filterExerciseCatalog(
  exercises: Exercise[],
  { query, muscle, tag }: ExerciseCatalogFilters,
) {
  const normalizedQuery = normalize(query);
  return exercises.filter((exercise) => {
    if (muscle !== 'all' && !exercise.primaryMuscles.includes(muscle)) return false;
    if (tag !== 'all' && exercise.tag !== tag) return false;
    if (!normalizedQuery) return true;
    const haystack = [
      exercise.nameRu,
      exercise.nameEn,
      ...exercise.aliases,
      ...exercise.equipment,
      ...exercise.primaryMuscles,
      ...exercise.secondaryMuscles,
    ];
    return haystack.some((value) => normalize(value).includes(normalizedQuery));
  });
}

export function catalogDiscoveryQuery(exercises: Exercise[], query: string) {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) return null;
  const catalogMatches = filterExerciseCatalog(exercises, {
    query: trimmedQuery,
    muscle: 'all',
    tag: 'all',
  });
  return catalogMatches.length === 0 ? trimmedQuery : null;
}

export function collapseExerciseCatalogDuplicates(exercises: Exercise[]) {
  const globalExercises = exercises.filter((exercise) => exercise.scope !== 'user');
  const globalKeys = new Set(
    globalExercises.flatMap((exercise) =>
      [exercise.nameRu, exercise.nameEn, ...exercise.aliases].map(normalize),
    ),
  );
  return exercises.filter(
    (exercise) =>
      exercise.scope !== 'user' ||
      ![exercise.nameRu, exercise.nameEn].some((name) => globalKeys.has(normalize(name))),
  );
}

export function groupExerciseChoicesByPrimaryMuscle(
  exercises: Exercise[],
  preferredMuscle: Exercise['primaryMuscles'][number] | null,
  locale: 'ru' | 'en',
): ExerciseChoiceGroup[] {
  const collator = new Intl.Collator(locale === 'en' ? 'en' : 'ru', {
    numeric: true,
    sensitivity: 'base',
  });
  const order =
    preferredMuscle === null
      ? muscleGroups
      : [preferredMuscle, ...muscleGroups.filter((muscle) => muscle !== preferredMuscle)];

  return order.flatMap((muscle) => {
    const matching = exercises
      .filter((exercise) => exercise.primaryMuscles[0] === muscle)
      .sort((left, right) =>
        collator.compare(
          locale === 'en' ? left.nameEn : left.nameRu,
          locale === 'en' ? right.nameEn : right.nameRu,
        ),
      );
    return matching.length ? [{ muscle, exercises: matching }] : [];
  });
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
