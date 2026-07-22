import { describe, expect, it } from 'vitest';

import type { Exercise } from '@mighty-cringe/contracts';

import { fallbackCatalog } from './fallbackCatalog';
import { parseNaturalSet } from './naturalSet';

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
      exercise: { nameRu: 'Румынская тяга' },
      draft: { weightKg: 72.5, reps: 8, rir: 2, comment: 'техника чистая' },
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
      exercise: { nameEn: 'Romanian deadlift' },
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
      exercise: { nameEn: 'Romanian deadlift' },
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
