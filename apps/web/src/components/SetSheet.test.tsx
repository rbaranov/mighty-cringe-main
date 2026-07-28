import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Exercise } from '@mighty-cringe/contracts';

import { SetSheet } from './SetSheet';
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

describe('SetSheet', () => {
  it('opens without forcing iOS Safari to focus and move the viewport', () => {
    const html = renderToStaticMarkup(
      <SetSheet
        defaults={null}
        exercise={exercise}
        initial={null}
        onClose={() => {}}
        onExplain={() => {}}
        onSave={() => {}}
      />,
    );

    expect(html).toContain('class="sheet set-sheet"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('aria-label="Уменьшить: Вес, кг"');
    expect(html).toContain('aria-label="Увеличить: Повторы"');
    expect(html).toContain('aria-label="Что такое RIR?"');
    expect(html).toContain('RIR — сколько повторов осталось бы в запасе');
    expect(html).not.toContain('autofocus');
  });

  it('accepts a decimal comma and formats weight steps for the active locale', () => {
    expect(parseDecimalInput('17,5')).toBe(17.5);
    expect(parseDecimalInput('17.5')).toBe(17.5);
    expect(parseDecimalInput('17,5,2')).toBeNull();

    expect(stepNumericInput('15', 1, 1, 0, 1000, 'ru')).toBe('16');
    expect(stepNumericInput('17,5', -1, 1, 0, 1000, 'ru')).toBe('16,5');
    expect(stepNumericInput('99', 1, 1, 1, 100, 'en')).toBe('100');
    expect(stepNumericInput('100', 1, 1, 1, 100, 'en')).toBe('100');
  });
});
