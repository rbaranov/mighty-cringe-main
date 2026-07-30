import { describe, expect, it } from 'vitest';

import type { Exercise } from '@mighty-cringe/contracts';

import { fallbackCatalog } from './fallbackCatalog';
import { buildNaturalSetExerciseContext, parseNaturalSet } from './naturalSet';

describe('natural set parsing', () => {
  it('parses spoken Russian numbers in a scoped exercise and keeps the comment', () => {
    expect(
      parseNaturalSet({
        text: 'сорок на двенадцать, один в запасе, грудь хорошо тянет',
        catalog: fallbackCatalog,
        scopedExercise: fallbackCatalog[2],
      }),
    ).toEqual({
      status: 'ready',
      exercise: fallbackCatalog[2],
      draft: {
        weightKg: 40,
        reps: 12,
        rir: 1,
        comment: 'грудь хорошо тянет',
      },
    });
  });

  it('recognizes a Russian alias, decimal weight, and explicit RIR', () => {
    expect(
      parseNaturalSet({
        text: 'Запиши румынку 72,5 на 8, RIR 2, техника чистая',
        catalog: fallbackCatalog,
      }),
    ).toMatchObject({
      status: 'ready',
      exercise: { nameRu: 'Румынская тяга со штангой' },
      draft: { weightKg: 72.5, reps: 8, rir: 2, comment: 'техника чистая' },
    });
  });

  it.each([
    ['12 с половиной килограмм на 10, осталось 0', 12.5, 0],
    ['двенадцать с половиной на десять, осталось ноль', 12.5, 0],
    ['12 с половинкой кг на 10, до отказа', 12.5, 0],
  ])('parses spoken half-kilogram weights and natural effort: %s', (text, weightKg, rir) => {
    expect(
      parseNaturalSet({
        text,
        catalog: fallbackCatalog,
        scopedExercise: fallbackCatalog[2],
      }),
    ).toMatchObject({
      status: 'ready',
      exercise: fallbackCatalog[2],
      draft: { weightKg, reps: 10, rir, comment: null },
    });
  });

  it('parses the reported voice phrasing without leaking number words into the comment', () => {
    expect(
      parseNaturalSet({
        text: 'разведение добавь подход 12 с половиной килограмм на 10 раз осталось 0',
        catalog: fallbackCatalog,
        scopedExercise: fallbackCatalog[1],
      }),
    ).toMatchObject({
      status: 'ready',
      exercise: fallbackCatalog[1],
      draft: { weightKg: 12.5, reps: 10, rir: 0, comment: 'разведение' },
    });
  });

  it('parses the reported conversational add-set command after workout commands decline it', () => {
    expect(
      parseNaturalSet({
        text: 'Добавь подход в жим штанги лежа 80 кг на 3 раза.',
        catalog: fallbackCatalog,
      }),
    ).toMatchObject({
      status: 'ready',
      exercise: { nameRu: 'Жим штанги лёжа на горизонтальной скамье' },
      draft: { weightKg: 80, reps: 3, comment: null },
    });
  });

  it('uses a unique abbreviated exercise name from the active plan before the fallback', () => {
    const standingPress = fallbackCatalog.find(
      (exercise) => exercise.nameRu === 'Жим гантелей стоя',
    )!;
    expect(
      parseNaturalSet({
        text: 'Добавить подход 10 на 20 на 1 жим гантелей',
        catalog: fallbackCatalog,
        preferredExercises: [standingPress],
        scopedExercise: fallbackCatalog[0],
      }),
    ).toMatchObject({
      status: 'ready',
      exercise: standingPress,
      draft: { weightKg: 10, reps: 20, rir: 1, comment: null },
    });
  });

  it('defaults to the first plan exercise with fewer than three sets', () => {
    const firstExercise = fallbackCatalog[0];
    const secondExercise = fallbackCatalog[1];
    const context = buildNaturalSetExerciseContext({
      catalog: fallbackCatalog,
      plan: [
        {
          id: '91000000-0000-4000-8000-000000000001',
          exerciseId: secondExercise.id,
          position: 1,
          supersetGroup: null,
        },
        {
          id: '91000000-0000-4000-8000-000000000002',
          exerciseId: firstExercise.id,
          position: 0,
          supersetGroup: null,
        },
      ],
      sets: [
        { exerciseId: firstExercise.id, deleted: false },
        { exerciseId: firstExercise.id, deleted: false },
        { exerciseId: firstExercise.id, deleted: false },
        { exerciseId: secondExercise.id, deleted: false },
        { exerciseId: secondExercise.id, deleted: true },
      ],
    });

    expect(context.preferredExercises).toEqual([firstExercise, secondExercise]);
    expect(context.fallbackExercise).toBe(secondExercise);
    expect(
      parseNaturalSet({
        text: 'Добавить подход 40 на 12 на 2',
        catalog: fallbackCatalog,
        preferredExercises: context.preferredExercises,
        scopedExercise: context.fallbackExercise,
      }),
    ).toMatchObject({
      status: 'ready',
      exercise: secondExercise,
      draft: { weightKg: 40, reps: 12, rir: 2, comment: null },
    });
  });

  it.each([
    ['40 х 20 х 0', 40, 20, 0],
    ['40x20x0', 40, 20, 0],
    ['30х10х0', 30, 10, 0],
    ['30 x 10 x 0', 30, 10, 0],
    ['30 на 10 на 0', 30, 10, 0],
    ['72,5 × 8 × 2, техника чистая', 72.5, 8, 2],
  ])('parses compact weight × reps × RIR notation: %s', (text, weightKg, reps, rir) => {
    expect(
      parseNaturalSet({
        text,
        catalog: fallbackCatalog,
        scopedExercise: fallbackCatalog[2],
      }),
    ).toMatchObject({
      status: 'ready',
      exercise: fallbackCatalog[2],
      draft: {
        weightKg,
        reps,
        rir,
        comment: text.includes('техника') ? 'техника чистая' : null,
      },
    });
  });

  it('does not guess an exercise from a compact set without exercise context', () => {
    expect(parseNaturalSet({ text: '40 х 20 х 0', catalog: fallbackCatalog })).toEqual({
      status: 'needs_clarification',
      question: 'Какое упражнение записать? Добавь название или его псевдоним.',
      candidates: [],
    });
  });

  it('recognizes an English catalog name and an all-out set', () => {
    expect(
      parseNaturalSet({
        text: 'Romanian deadlift 100 kg x 6, до отказа',
        catalog: fallbackCatalog,
      }),
    ).toMatchObject({
      status: 'ready',
      exercise: { nameEn: 'Barbell Romanian deadlift' },
      draft: { weightKg: 100, reps: 6, rir: 0 },
    });
  });

  it('uses English clarification copy and converts an imperial set to canonical kilograms', () => {
    expect(
      parseNaturalSet({
        text: 'Romanian deadlift 220 pounds for 6, 2 reps in reserve, smooth tempo',
        catalog: fallbackCatalog,
        locale: 'en',
        unitSystem: 'imperial',
      }),
    ).toMatchObject({
      status: 'ready',
      exercise: { nameEn: 'Barbell Romanian deadlift' },
      draft: { weightKg: 99.79, reps: 6, rir: 2, comment: 'smooth tempo' },
    });

    expect(parseNaturalSet({ text: '', catalog: fallbackCatalog, locale: 'en' })).toMatchObject({
      status: 'needs_clarification',
      question: 'Describe a set, for example: “bench press 175 for 8, RIR 2”.',
    });
  });

  it('asks for the missing values instead of guessing', () => {
    expect(parseNaturalSet({ text: 'жим лёжа было тяжело', catalog: fallbackCatalog })).toEqual({
      status: 'needs_clarification',
      question: 'Уточни вес и повторы, например: «40 на 12».',
      candidates: [],
    });
  });

  it('preserves the capitalization of a separate free-text comment', () => {
    expect(
      parseNaturalSet({
        text: 'жим лёжа 80 на 8, RIR 2, Грудь отлично тянет',
        catalog: fallbackCatalog,
      }),
    ).toMatchObject({ status: 'ready', draft: { comment: 'Грудь отлично тянет' } });
  });

  it('asks the user to choose when an alias is ambiguous', () => {
    const ambiguousCatalog: Exercise[] = [
      { ...fallbackCatalog[0], aliases: ['тяга'] },
      { ...fallbackCatalog[7], aliases: ['тяга'] },
    ];
    expect(parseNaturalSet({ text: 'тяга 60 на 10', catalog: ambiguousCatalog })).toMatchObject({
      status: 'needs_clarification',
      question: 'Какое именно упражнение ты имеешь в виду?',
      candidates: ambiguousCatalog,
    });
  });
});
