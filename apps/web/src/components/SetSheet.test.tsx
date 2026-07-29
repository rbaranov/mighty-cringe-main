import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Exercise } from '@mighty-cringe/contracts';

import type { LocalSet } from '../lib/db';
import { SetSheet, setWeightStep } from './SetSheet';
import { parseDecimalInput, stepNumericInput } from './setSheetNumbers';

const exercise: Exercise = {
  id: '10000000-0000-4000-8000-000000000003',
  nameRu: 'Жим лёжа',
  nameEn: 'Bench press',
  aliases: [],
  tag: 'mighty',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['triceps'],
  equipment: ['barbell'],
};
const existingSet: LocalSet = {
  id: '50000000-0000-4000-8000-000000000001',
  workoutId: '30000000-0000-4000-8000-000000000001',
  exerciseId: exercise.id,
  weightKg: 80,
  reps: 8,
  rir: 2,
  comment: null,
  entrySource: 'manual',
  performedAt: '2026-07-29T12:00:00.000Z',
  position: 0,
  revision: 1,
  updatedAt: '2026-07-29T12:00:00.000Z',
  syncState: 'synced',
  deleted: false,
};

describe('SetSheet', () => {
  it('opens without forcing iOS Safari to focus and move the viewport', () => {
    const html = renderToStaticMarkup(
      <SetSheet
        defaults={null}
        exercise={exercise}
        initial={null}
        onClose={() => {}}
        onDelete={null}
        onExplain={() => {}}
        onSave={() => {}}
      />,
    );

    expect(html).toContain('class="sheet set-sheet"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('enterKeyHint="next"');
    expect(html).toContain('enterKeyHint="done"');
    expect(html).toContain('aria-label="Уменьшить: Вес, кг"');
    expect(html).toContain('aria-label="Увеличить: Повторы"');
    expect(html).toContain('aria-label="Что такое RIR?"');
    expect(html).toContain('RIR — сколько повторов осталось бы в запасе');
    expect(html).not.toContain('autofocus');
  });

  it('offers deletion whenever an existing set is edited', () => {
    const html = renderToStaticMarkup(
      <SetSheet
        defaults={null}
        exercise={exercise}
        initial={existingSet}
        onClose={() => {}}
        onDelete={() => {}}
        onExplain={() => {}}
        onSave={() => {}}
      />,
    );

    expect(html).toContain('>Удалить подход</button>');
  });

  it('accepts a decimal comma and changes weight by one displayed unit', () => {
    expect(parseDecimalInput('17,5')).toBe(17.5);
    expect(parseDecimalInput('17.5')).toBe(17.5);
    expect(parseDecimalInput('17,5,2')).toBeNull();

    expect(setWeightStep).toBe(1);
    expect(stepNumericInput('17,5', 1, setWeightStep, 0, 1000, 'ru')).toBe('18,5');
    expect(stepNumericInput('17,5', -1, setWeightStep, 0, 1000, 'ru')).toBe('16,5');
    expect(stepNumericInput('99', 1, 1, 1, 100, 'en')).toBe('100');
    expect(stepNumericInput('100', 1, 1, 1, 100, 'en')).toBe('100');
  });
});
