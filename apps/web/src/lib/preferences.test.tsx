import { describe, expect, it } from 'vitest';

import {
  canonicalLength,
  canonicalMeasurementNumber,
  canonicalWeight,
  displayLength,
  displayMeasurement,
  displayMeasurementNumber,
  displayWeight,
  exerciseName,
  formatExerciseCount,
  measurementUnit,
  tr,
} from './preferences';

describe('profile preferences', () => {
  it('selects localized catalog names', () => {
    const exercise = {
      id: '10000000-0000-4000-8000-000000000001',
      nameRu: 'Жим лёжа',
      nameEn: 'Bench press',
      aliases: [],
      tag: 'mighty' as const,
      primaryMuscles: ['chest' as const],
      secondaryMuscles: [],
      equipment: [],
    };
    expect(exerciseName(exercise, 'ru')).toBe('Жим лёжа');
    expect(exerciseName(exercise, 'en')).toBe('Bench press');
    expect(tr('en', 'Настройки', 'Settings')).toBe('Settings');
  });

  it('formats localized exercise counts', () => {
    expect(formatExerciseCount(1, 'ru')).toBe('1 упражнение');
    expect(formatExerciseCount(2, 'ru')).toBe('2 упражнения');
    expect(formatExerciseCount(5, 'ru')).toBe('5 упражнений');
    expect(formatExerciseCount(11, 'ru')).toBe('11 упражнений');
    expect(formatExerciseCount(21, 'ru')).toBe('21 упражнение');
    expect(formatExerciseCount(1, 'en')).toBe('1 exercise');
    expect(formatExerciseCount(3, 'en')).toBe('3 exercises');
  });

  it('round-trips canonical metric values through imperial display', () => {
    expect(displayWeight(100, 'imperial')).toBe(220.5);
    expect(canonicalWeight(220.5, 'imperial')).toBeCloseTo(100, 1);
    expect(displayLength(180, 'imperial')).toBe(70.9);
    expect(canonicalLength(70.9, 'imperial')).toBe(180.09);
  });

  it('keeps body-fat percentage independent from the selected unit system', () => {
    expect(displayMeasurement('bodyFatPercent', 18.5, 'ru', 'imperial')).toBe('18,5 %');
    expect(displayMeasurementNumber('bodyFatPercent', 18.5, 'imperial')).toBe(18.5);
    expect(canonicalMeasurementNumber('bodyFatPercent', 18.5, 'imperial')).toBe(18.5);
    expect(measurementUnit('bodyFatPercent', 'imperial')).toBe('%');
  });
});
