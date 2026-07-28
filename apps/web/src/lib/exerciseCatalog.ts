import type { Exercise } from '@mighty-cringe/contracts';

export type ExerciseCatalogFilters = {
  query: string;
  muscle: Exercise['primaryMuscles'][number] | 'all';
  tag: Exercise['tag'] | 'all';
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

function normalize(value: string) {
  return value
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
