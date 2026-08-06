import {
  muscleGroups,
  type Exercise,
  type ExercisePreferenceValue,
} from '@mighty-cringe/contracts';

export type ExercisePreferenceLookup = ReadonlyMap<
  string,
  ExercisePreferenceValue | null | undefined
>;

export type ExerciseCatalogFilters = {
  query: string;
  muscle: Exercise['primaryMuscles'][number] | 'all';
  tag: Exercise['tag'] | 'all';
  preference?: ExercisePreferenceValue | 'unmarked' | 'all';
};

export type ExerciseChoiceGroup = {
  muscle: Exercise['primaryMuscles'][number];
  exercises: Exercise[];
};

type Muscle = Exercise['primaryMuscles'][number];

const muscleSearchTerms: Record<Muscle, readonly string[]> = {
  chest: [
    'грудь',
    'груди',
    'грудные',
    'грудная мышца',
    'грудные мышцы',
    'chest',
    'pec',
    'pecs',
    'pectoral',
  ],
  back: [
    'спина',
    'спины',
    'мышцы спины',
    'широчайшие',
    'широчайшая',
    'back',
    'lat',
    'lats',
    'latissimus',
  ],
  front_delt: [
    'передняя дельта',
    'передние дельты',
    'передний пучок',
    'передняя дельтовидная',
    'плечи',
    'дельты',
    'front delt',
    'anterior delt',
    'shoulders',
  ],
  middle_delt: [
    'средняя дельта',
    'средние дельты',
    'боковая дельта',
    'средний пучок',
    'средняя дельтовидная',
    'плечи',
    'дельты',
    'middle delt',
    'side delt',
    'lateral delt',
    'shoulders',
  ],
  rear_delt: [
    'задняя дельта',
    'задние дельты',
    'задней дельты',
    'задний пучок',
    'задняя дельтовидная',
    'плечи',
    'дельты',
    'rear delt',
    'posterior delt',
    'shoulders',
  ],
  biceps: ['бицепс', 'бицепсы', 'двуглавая мышца плеча', 'biceps', 'bicep'],
  triceps: ['трицепс', 'трицепсы', 'трехглавая мышца плеча', 'triceps', 'tricep'],
  quadriceps: [
    'квадрицепс',
    'квадрицепсы',
    'передняя поверхность бедра',
    'передняя поверхность ног',
    'quadriceps',
    'quads',
  ],
  hamstrings: [
    'бицепс бедра',
    'бицепсы бедер',
    'задняя поверхность бедра',
    'задняя поверхность ног',
    'hamstrings',
    'hamstring',
  ],
  glutes: [
    'ягодицы',
    'ягодичные',
    'ягодичная мышца',
    'ягодичные мышцы',
    'glutes',
    'glute',
    'gluteus',
  ],
  adductors: [
    'приводящие',
    'приводящие мышцы',
    'внутренняя поверхность бедра',
    'adductors',
    'adductor',
    'inner thigh',
  ],
  calves: ['икры', 'икроножные', 'икроножная мышца', 'голень', 'calves', 'calf'],
  core: ['кор', 'мышцы кора', 'пресс', 'живот', 'core', 'abs', 'abdominals'],
};

export function filterExerciseCatalog(
  exercises: Exercise[],
  { query, muscle, tag, preference = 'all' }: ExerciseCatalogFilters,
  preferences: ExercisePreferenceLookup = new Map(),
) {
  const filtered = exercises.filter((exercise) => {
    if (muscle !== 'all' && !exercise.primaryMuscles.includes(muscle)) return false;
    if (tag !== 'all' && exercise.tag !== tag) return false;
    const value = preferences.get(exercise.id) ?? null;
    if (preference === 'unmarked' && value !== null) return false;
    if (preference !== 'all' && preference !== 'unmarked' && value !== preference) return false;
    return true;
  });
  return searchExerciseCatalog(filtered, query);
}

export function searchExerciseCatalog(exercises: Exercise[], query: string) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return exercises;

  return exercises
    .map((exercise, index) => ({
      exercise,
      index,
      score: exerciseSearchScore(exercise, normalizedQuery),
    }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((result) => result.exercise);
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

export function replacementExerciseOptions({
  exercises,
  mode,
  preferences,
  query,
  unavailableIds,
}: {
  exercises: Exercise[];
  mode: 'add' | 'replace';
  preferences: ExercisePreferenceLookup;
  query: string;
  unavailableIds: ReadonlySet<string>;
}) {
  const normalizedQuery = normalize(query);
  const matchingCatalog = searchExerciseCatalog(exercises, query);
  const availableMatches = matchingCatalog.filter((exercise) => !unavailableIds.has(exercise.id));
  return {
    matchingCatalog,
    options: availableMatches.filter(
      (exercise) => mode === 'add' || preferences.get(exercise.id) !== 'dislike',
    ),
    explicitDislikedOptions:
      mode === 'replace' && normalizedQuery
        ? availableMatches.filter((exercise) => preferences.get(exercise.id) === 'dislike')
        : [],
  };
}

export function groupExerciseChoicesByPrimaryMuscle(
  exercises: Exercise[],
  preferredMuscle: Exercise['primaryMuscles'][number] | null,
  locale: 'ru' | 'en',
  preferences: ExercisePreferenceLookup = new Map(),
  query = '',
): ExerciseChoiceGroup[] {
  const collator = new Intl.Collator(locale === 'en' ? 'en' : 'ru', {
    numeric: true,
    sensitivity: 'base',
  });
  const defaultOrder =
    preferredMuscle === null
      ? muscleGroups
      : [preferredMuscle, ...muscleGroups.filter((muscle) => muscle !== preferredMuscle)];
  const inputOrder = new Map(exercises.map((exercise, index) => [exercise.id, index]));
  const normalizedQuery = normalize(query);
  const order = normalizedQuery
    ? [...defaultOrder].sort(
        (left, right) =>
          firstExerciseIndex(exercises, left) - firstExerciseIndex(exercises, right) ||
          defaultOrder.indexOf(left) - defaultOrder.indexOf(right),
      )
    : defaultOrder;

  return order.flatMap((muscle) => {
    const matching = exercises
      .filter((exercise) => exercise.primaryMuscles[0] === muscle)
      .sort((left, right) => {
        if (normalizedQuery) {
          const searchOrder = inputOrder.get(left.id)! - inputOrder.get(right.id)!;
          if (searchOrder !== 0) return searchOrder;
        }
        const preferenceOrder =
          preferenceRank(preferences.get(left.id)) - preferenceRank(preferences.get(right.id));
        if (preferenceOrder !== 0) return preferenceOrder;
        return collator.compare(
          locale === 'en' ? left.nameEn : left.nameRu,
          locale === 'en' ? right.nameEn : right.nameRu,
        );
      });
    return matching.length ? [{ muscle, exercises: matching }] : [];
  });
}

function firstExerciseIndex(exercises: Exercise[], muscle: Muscle) {
  const index = exercises.findIndex((exercise) => exercise.primaryMuscles[0] === muscle);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function exerciseSearchScore(exercise: Exercise, normalizedQuery: string) {
  return Math.max(
    ...[exercise.nameRu, exercise.nameEn].map((value) =>
      textMatchScore(value, normalizedQuery, 500),
    ),
    ...exercise.aliases.map((value) => textMatchScore(value, normalizedQuery, 420)),
    ...exercise.equipment.map((value) => textMatchScore(value, normalizedQuery, 300)),
    ...exercise.primaryMuscles.flatMap((muscle) =>
      [muscle, ...muscleSearchTerms[muscle]].map((value) =>
        textMatchScore(value, normalizedQuery, 220),
      ),
    ),
    ...exercise.secondaryMuscles.flatMap((muscle) =>
      [muscle, ...muscleSearchTerms[muscle]].map((value) =>
        textMatchScore(value, normalizedQuery, 180),
      ),
    ),
  );
}

function textMatchScore(value: string, normalizedQuery: string, base: number) {
  const normalizedValue = normalize(value);
  if (!normalizedValue) return 0;
  if (normalizedValue === normalizedQuery) return base + 40;
  if (normalizedValue.startsWith(`${normalizedQuery} `)) return base + 30;
  if (normalizedValue.includes(normalizedQuery)) return base + 20;
  return tokenStems(normalizedQuery).every((queryToken) =>
    tokenStems(normalizedValue).some((valueToken) => valueToken === queryToken),
  )
    ? base + 10
    : 0;
}

function tokenStems(value: string) {
  return normalize(value)
    .split(' ')
    .filter(Boolean)
    .map((token) => (token.length > 4 ? token.slice(0, Math.max(4, token.length - 2)) : token));
}

function preferenceRank(value: ExercisePreferenceValue | null | undefined) {
  return value === 'like' ? 0 : value === 'dislike' ? 2 : 1;
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
