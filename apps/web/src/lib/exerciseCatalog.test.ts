import { describe, expect, it } from 'vitest';

import { globalExerciseCatalog } from '@mighty-cringe/contracts';

import {
  collapseExerciseCatalogDuplicates,
  filterExerciseCatalog,
  groupExerciseChoicesByPrimaryMuscle,
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
});
