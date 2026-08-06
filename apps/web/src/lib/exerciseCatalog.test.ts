import { describe, expect, it } from 'vitest';

import { globalExerciseCatalog, type Exercise } from '@mighty-cringe/contracts';

import {
  catalogDiscoveryQuery,
  collapseExerciseCatalogDuplicates,
  filterExerciseCatalog,
  groupExerciseChoicesByPrimaryMuscle,
  replacementExerciseOptions,
} from './exerciseCatalog';

describe('filterExerciseCatalog', () => {
  it('combines aliases, muscle and tag filters', () => {
    const result = filterExerciseCatalog(globalExerciseCatalog, {
      query: 'пэк дек',
      muscle: 'chest',
      tag: 'mighty',
    });

    expect(result.map((exercise) => exercise.nameRu)).toEqual([
      'Сведение рук в тренажёре «бабочка»',
    ]);
  });

  it('finds owner shorthand through aliases', () => {
    const result = filterExerciseCatalog(globalExerciseCatalog, {
      query: 'тяга арни style',
      muscle: 'all',
      tag: 'all',
    });

    expect(result[0]?.nameRu).toBe('Тяга одной рукой в кроссовере сидя');
  });

  it('finds primary and secondary muscles through Russian forms and gym synonyms', () => {
    const rearDeltResults = filterExerciseCatalog(globalExerciseCatalog, {
      query: 'задней дельты',
      muscle: 'all',
      tag: 'all',
    });

    expect(rearDeltResults.length).toBeGreaterThan(1);
    expect(
      rearDeltResults.every(
        (exercise) =>
          exercise.primaryMuscles.includes('rear_delt') ||
          exercise.secondaryMuscles.includes('rear_delt'),
      ),
    ).toBe(true);

    const hamstringResults = filterExerciseCatalog(globalExerciseCatalog, {
      query: 'задняя поверхность бедра',
      muscle: 'all',
      tag: 'all',
    });
    expect(
      hamstringResults.some((exercise) => exercise.primaryMuscles.includes('hamstrings')),
    ).toBe(true);
  });

  it('ranks a name match above less precise muscle matches', () => {
    const muscleMatch = {
      ...globalExerciseCatalog[0],
      primaryMuscles: ['chest'] as Exercise['primaryMuscles'],
    };
    const nameMatch = {
      ...globalExerciseCatalog[1],
      nameRu: 'Грудь в кроссовере',
      primaryMuscles: ['back'] as Exercise['primaryMuscles'],
    };

    const result = filterExerciseCatalog([muscleMatch, nameMatch], {
      query: 'грудь',
      muscle: 'all',
      tag: 'all',
    });

    expect(result).toEqual([nameMatch, muscleMatch]);
  });

  it('filters liked, disliked, and unmarked exercises independently from global tags', () => {
    const [liked, disliked, unmarked] = globalExerciseCatalog.slice(0, 3);
    const preferences = new Map([
      [liked!.id, 'like' as const],
      [disliked!.id, 'dislike' as const],
    ]);
    const input = [liked!, disliked!, unmarked!];

    expect(
      filterExerciseCatalog(
        input,
        { query: '', muscle: 'all', tag: 'all', preference: 'like' },
        preferences,
      ),
    ).toEqual([liked]);
    expect(
      filterExerciseCatalog(
        input,
        { query: '', muscle: 'all', tag: 'all', preference: 'dislike' },
        preferences,
      ),
    ).toEqual([disliked]);
    expect(
      filterExerciseCatalog(
        input,
        { query: '', muscle: 'all', tag: 'all', preference: 'unmarked' },
        preferences,
      ),
    ).toEqual([unmarked]);
  });

  it('keeps the global canonical card instead of a legacy personal shorthand', () => {
    const personal = {
      ...globalExerciseCatalog[0],
      id: '90000000-0000-4000-8000-000000000001',
      scope: 'user' as const,
      nameRu: 'Пуловер',
      nameEn: 'Pullover',
      aliases: [],
    };

    const result = collapseExerciseCatalogDuplicates([...globalExerciseCatalog, personal]);

    expect(result).not.toContain(personal);
    expect(result.some((exercise) => exercise.nameRu === 'Пуловер на верхнем блоке стоя')).toBe(
      true,
    );
  });

  it('does not hide a distinct personal exercise only because one alias is shared', () => {
    const personal = {
      ...globalExerciseCatalog[0],
      id: '90000000-0000-4000-8000-000000000002',
      scope: 'user' as const,
      nameRu: 'Молотковые сгибания рук с гантелями стоя',
      nameEn: 'Standing dumbbell hammer curl',
      aliases: ['сгибание рук'],
    };

    const result = collapseExerciseCatalogDuplicates([...globalExerciseCatalog, personal]);

    expect(result).toContain(personal);
  });

  it('groups replacement choices by primary muscle and puts the source muscle first', () => {
    const choices = globalExerciseCatalog.filter((exercise) =>
      ['back', 'chest', 'biceps'].includes(exercise.primaryMuscles[0]),
    );
    const groups = groupExerciseChoicesByPrimaryMuscle(choices, 'biceps', 'ru');

    expect(groups[0]?.muscle).toBe('biceps');
    expect(groups.flatMap((group) => group.exercises)).toHaveLength(choices.length);
    for (const group of groups) {
      expect(group.exercises.map((exercise) => exercise.nameRu)).toEqual(
        [...group.exercises]
          .map((exercise) => exercise.nameRu)
          .sort((left, right) =>
            new Intl.Collator('ru', { numeric: true, sensitivity: 'base' }).compare(left, right),
          ),
      );
    }
  });

  it('puts liked replacements before neutral choices inside a muscle group', () => {
    const choices = globalExerciseCatalog.filter(
      (exercise) => exercise.primaryMuscles[0] === 'chest',
    );
    const liked = choices.at(-1)!;
    const groups = groupExerciseChoicesByPrimaryMuscle(
      choices,
      'chest',
      'ru',
      new Map([[liked.id, 'like']]),
    );

    expect(groups[0]?.exercises[0]).toBe(liked);
  });

  it('hides disliked replacements by default but reveals explicit search matches', () => {
    const disliked = globalExerciseCatalog.find((exercise) => exercise.aliases.length > 0)!;
    const preferences = new Map([[disliked.id, 'dislike' as const]]);

    const defaultOptions = replacementExerciseOptions({
      exercises: globalExerciseCatalog,
      mode: 'replace',
      preferences,
      query: '',
      unavailableIds: new Set(),
    });
    expect(defaultOptions.options).not.toContain(disliked);
    expect(defaultOptions.explicitDislikedOptions).toEqual([]);

    const explicitOptions = replacementExerciseOptions({
      exercises: globalExerciseCatalog,
      mode: 'replace',
      preferences,
      query: disliked.aliases[0]!,
      unavailableIds: new Set(),
    });
    expect(explicitOptions.options).not.toContain(disliked);
    expect(explicitOptions.explicitDislikedOptions).toContain(disliked);

    const addOptions = replacementExerciseOptions({
      exercises: globalExerciseCatalog,
      mode: 'add',
      preferences,
      query: disliked.aliases[0]!,
      unavailableIds: new Set(),
    });
    expect(addOptions.options).toContain(disliked);
  });

  it('uses the same muscle-aware ranking while choosing a workout exercise', () => {
    const muscleMatch = {
      ...globalExerciseCatalog[0],
      primaryMuscles: ['rear_delt'] as Exercise['primaryMuscles'],
    };
    const secondaryMatch = {
      ...globalExerciseCatalog[1],
      primaryMuscles: ['back'] as Exercise['primaryMuscles'],
      secondaryMuscles: ['rear_delt'] as Exercise['secondaryMuscles'],
    };
    const nameMatch = {
      ...globalExerciseCatalog[2],
      nameRu: 'Задняя дельта в тренажёре',
      primaryMuscles: ['chest'] as Exercise['primaryMuscles'],
    };

    const result = replacementExerciseOptions({
      exercises: [muscleMatch, secondaryMatch, nameMatch],
      mode: 'add',
      preferences: new Map(),
      query: 'задняя дельта',
      unavailableIds: new Set(),
    });
    const groups = groupExerciseChoicesByPrimaryMuscle(
      result.options,
      null,
      'ru',
      new Map(),
      'задняя дельта',
    );

    expect(result.options).toEqual([nameMatch, muscleMatch, secondaryMatch]);
    expect(groups.flatMap((group) => group.exercises)).toEqual([
      nameMatch,
      muscleMatch,
      secondaryMatch,
    ]);
  });
});

describe('catalogDiscoveryQuery', () => {
  it('keeps an unresolved catalog query for one-tap online discovery', () => {
    expect(catalogDiscoveryQuery(globalExerciseCatalog, '  Тяга сумо а  ')).toBe('Тяга сумо а');
  });

  it('does not offer online discovery for an existing catalog match or an empty query', () => {
    expect(catalogDiscoveryQuery(globalExerciseCatalog, 'пэк дек')).toBeNull();
    expect(catalogDiscoveryQuery(globalExerciseCatalog, ' ')).toBeNull();
  });
});
