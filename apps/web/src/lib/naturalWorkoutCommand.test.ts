import { describe, expect, it } from 'vitest';

import type { WorkoutExercise } from '@mighty-cringe/contracts';

import { fallbackCatalog } from './fallbackCatalog';
import { parseNaturalWorkoutCommand, workoutCommandSummary } from './naturalWorkoutCommand';
import { applyWorkoutCommandToPlan } from './workoutPlan';

const plan: WorkoutExercise[] = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    exerciseId: fallbackCatalog[0].id,
    position: 0,
    supersetGroup: null,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    exerciseId: fallbackCatalog[2].id,
    position: 1,
    supersetGroup: null,
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    exerciseId: fallbackCatalog[1].id,
    position: 2,
    supersetGroup: null,
  },
];

describe('natural workout commands', () => {
  it('replaces one planned exercise with a catalog exercise', () => {
    const result = parseNaturalWorkoutCommand({
      text: 'Замени тягу верхнего блока на румынскую тягу',
      catalog: fallbackCatalog,
      plan,
    });

    expect(result).toMatchObject({
      status: 'command_ready',
      command: {
        type: 'replace',
        source: { exercise: { nameRu: 'Тяга верхнего блока прямым хватом' } },
        replacement: { nameRu: 'Румынская тяга со штангой' },
      },
    });
    if (result.status === 'command_ready') {
      expect(workoutCommandSummary(result.command, 'ru')).toBe(
        'Заменить «Тяга верхнего блока прямым хватом» на «Румынская тяга со штангой». Уже записанные подходы останутся в истории.',
      );
      expect(
        applyWorkoutCommandToPlan(plan, result.command).map((item) => item.exerciseId),
      ).toEqual([fallbackCatalog[6].id, fallbackCatalog[2].id, fallbackCatalog[1].id]);
    }
  });

  it('resolves the owner shorthand after it enters the global catalog', () => {
    expect(
      parseNaturalWorkoutCommand({
        text: 'Замени тягу верхнего блока на тягу арни',
        catalog: fallbackCatalog,
        plan,
      }),
    ).toMatchObject({
      status: 'command_ready',
      command: {
        type: 'replace',
        replacement: { nameRu: 'Тяга одной рукой в кроссовере сидя' },
      },
    });
  });

  it('keeps the full quoted target when source and replacement share a prefix', () => {
    expect(
      parseNaturalWorkoutCommand({
        text: 'замени жим штанги лежа на "жим штанги лежа на наклонной скамье"',
        catalog: fallbackCatalog,
        plan,
      }),
    ).toMatchObject({
      status: 'command_ready',
      command: {
        type: 'replace',
        source: { exercise: { nameRu: 'Жим штанги лёжа на горизонтальной скамье' } },
        replacement: { nameRu: 'Жим штанги лёжа на наклонной скамье' },
      },
    });
  });

  it('understands the reported polite Russian voice command without asking for set volume', () => {
    expect(
      parseNaturalWorkoutCommand({
        text: 'Можешь заменить жим лежа на жим лежа на наклонной скамье',
        catalog: fallbackCatalog,
        plan,
      }),
    ).toMatchObject({
      status: 'command_ready',
      command: {
        type: 'replace',
        source: { exercise: { nameRu: 'Жим штанги лёжа на горизонтальной скамье' } },
        replacement: { nameRu: 'Жим штанги лёжа на наклонной скамье' },
      },
    });
  });

  it('understands source-first replacement phrasing and a Latin c typo', () => {
    const genericCurl = {
      ...fallbackCatalog[3],
      id: '70000000-0000-4000-8000-000000000002',
      nameRu: 'Сгибание рук',
      nameEn: 'Arm curl',
      aliases: ['сгибание рук'],
    };
    const curlPlan: WorkoutExercise[] = [
      {
        id: '20000000-0000-4000-8000-000000000004',
        exerciseId: genericCurl.id,
        position: 0,
        supersetGroup: null,
      },
    ];

    expect(
      parseNaturalWorkoutCommand({
        text: 'Сгибание рук поменяй на сгибание рук c гантелями.',
        catalog: [...fallbackCatalog, genericCurl],
        plan: curlPlan,
      }),
    ).toMatchObject({
      status: 'command_ready',
      command: {
        type: 'replace',
        source: { exercise: { nameRu: 'Сгибание рук' } },
        replacement: { nameRu: 'Сгибание рук с гантелями стоя' },
      },
    });
  });

  it('recognizes the reported phrase as a command when the replacement is already selected', () => {
    const cachedCurl = {
      ...fallbackCatalog[3],
      aliases: fallbackCatalog[3].aliases.filter((alias) => alias !== 'сгибание рук'),
    };
    const curlPlan: WorkoutExercise[] = [
      {
        id: '20000000-0000-4000-8000-000000000005',
        exerciseId: cachedCurl.id,
        position: 0,
        supersetGroup: null,
      },
    ];

    expect(
      parseNaturalWorkoutCommand({
        text: 'Сгибание рук поменяй на сгибание рук c гантелями.',
        catalog: fallbackCatalog.map((exercise) =>
          exercise.id === cachedCurl.id ? cachedCurl : exercise,
        ),
        plan: curlPlan,
      }),
    ).toMatchObject({
      status: 'command_needs_clarification',
      role: 'target',
      question: 'Выбрано то же упражнение. Укажи, на что его заменить.',
    });
  });

  it('completes the original command after a discovered alias enters the personal catalog', () => {
    const personalExercise = {
      ...fallbackCatalog[7],
      id: '70000000-0000-4000-8000-000000000001',
      scope: 'user' as const,
      nameRu: 'Тяга гантели одной рукой',
      nameEn: 'One-arm dumbbell row',
      aliases: ['тяга зорро'],
    };

    expect(
      parseNaturalWorkoutCommand({
        text: 'Замени тягу верхнего блока на тягу зорро',
        catalog: [...fallbackCatalog, personalExercise],
        plan,
      }),
    ).toMatchObject({
      status: 'command_ready',
      command: {
        type: 'replace',
        replacement: { id: personalExercise.id, scope: 'user' },
      },
    });
  });

  it('adds an exercise at a requested position', () => {
    expect(
      parseNaturalWorkoutCommand({
        text: 'Добавь румынскую тягу после жима лёжа',
        catalog: fallbackCatalog,
        plan,
      }),
    ).toMatchObject({
      status: 'command_ready',
      command: {
        type: 'add',
        exercise: { nameRu: 'Румынская тяга со штангой' },
        anchor: { exercise: { nameRu: 'Жим штанги лёжа на горизонтальной скамье' } },
        placement: 'after',
      },
    });
  });

  it('removes a planned exercise', () => {
    expect(
      parseNaturalWorkoutCommand({
        text: 'Убери махи в стороны',
        catalog: fallbackCatalog,
        plan,
      }),
    ).toMatchObject({
      status: 'command_ready',
      command: {
        type: 'remove',
        source: { exercise: { nameRu: 'Разведение гантелей в стороны стоя' } },
      },
    });
  });

  it('moves one exercise relative to another', () => {
    const result = parseNaturalWorkoutCommand({
      text: 'Переставь жим лёжа перед верхним блоком',
      catalog: fallbackCatalog,
      plan,
    });
    expect(result).toMatchObject({
      status: 'command_ready',
      command: {
        type: 'move',
        source: { exercise: { nameRu: 'Жим штанги лёжа на горизонтальной скамье' } },
        anchor: { exercise: { nameRu: 'Тяга верхнего блока прямым хватом' } },
        placement: 'before',
      },
    });
    if (result.status === 'command_ready') {
      expect(
        applyWorkoutCommandToPlan(plan, result.command).map((item) => item.exerciseId),
      ).toEqual([fallbackCatalog[2].id, fallbackCatalog[0].id, fallbackCatalog[1].id]);
    }
  });

  it('supports English commands and catalog names', () => {
    const result = parseNaturalWorkoutCommand({
      text: 'Move bench press after lateral raise',
      catalog: fallbackCatalog,
      plan,
      locale: 'en',
    });
    expect(result).toMatchObject({
      status: 'command_ready',
      command: { type: 'move', placement: 'after' },
    });
  });

  it('does not intercept a normal set phrase', () => {
    expect(
      parseNaturalWorkoutCommand({
        text: 'тяга верхнего блока 60 на 10 RIR 2',
        catalog: fallbackCatalog,
        plan,
      }),
    ).toEqual({ status: 'not_command' });
  });
});
