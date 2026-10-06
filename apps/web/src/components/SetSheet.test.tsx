import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Exercise } from '@mighty-cringe/contracts';

import type { LocalSet } from '../lib/db';
import {
  claimSetSubmission,
  keyboardViewportStyle,
  revealScrollDelta,
  SetSheet,
  setWeightStep,
} from './SetSheet';
import { canonicalSetWeight, parseDecimalInput, stepNumericInput } from './setSheetNumbers';

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

    expect(html).toContain('class="sheet set-sheet set-entry-sheet"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('enterKeyHint="next"');
    expect(html).toContain('enterKeyHint="done"');
    expect(html).toContain('aria-label="Уменьшить: Вес, кг"');
    expect(html).toContain('aria-label="Увеличить: Повторы"');
    expect(html).toContain('aria-label="Что такое RIR?"');
    expect(html).toContain('RIR — сколько повторов осталось бы в запасе');
    expect(html).not.toContain('autofocus');
  });

  it('prefills matching ordinal history as immediately savable values', () => {
    const html = renderToStaticMarkup(
      <SetSheet
        exercise={exercise}
        initial={null}
        defaults={existingSet}
        setNumber={2}
        previousWorkoutDate="2026-07-29T12:00:00.000Z"
        previousSets={[{ ...existingSet, id: 'first', weightKg: 70 }, existingSet]}
        onClose={() => {}}
        onDelete={null}
        onExplain={() => {}}
        onSave={() => {}}
      />,
    );
    expect(html).toContain('Подход №2');
    expect(html).toContain('Последняя тренировка');
    expect(html).toContain('70 кг');
    expect(html).toContain('80 кг');
    expect(html).toContain('Прошлый подход №2');
    expect(html).toContain('value="80"');
    expect(html).toContain('value="8"');
    expect(html).toContain('value="2"');
    expect(html).not.toContain('placeholder="80"');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Сохранить подход/);
  });

  it('keeps the microphone outside collapsed details and prefills the fallback including zero RIR', () => {
    const html = renderToStaticMarkup(
      <SetSheet
        exercise={exercise}
        initial={null}
        defaults={{ ...existingSet, weightKg: 0, rir: 0 }}
        useLatest
        onClose={() => {}}
        onDelete={null}
        onExplain={() => {}}
        onSave={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Сказать или написать"');
    expect(html).not.toContain('Комментарий и ещё');
    expect(html).toContain('class="set-entry-extras"');
    expect(html).toContain('Последний результат');
    expect(html.match(/value="0"/g)).toHaveLength(2);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Сохранить подход/);
  });

  it('keeps edited values ahead of defaults and leaves a first-ever set empty', () => {
    const props = {
      exercise,
      onClose: () => {},
      onDelete: null,
      onExplain: () => {},
      onSave: () => {},
    };
    const edited = renderToStaticMarkup(
      <SetSheet {...props} initial={existingSet} defaults={{ ...existingSet, weightKg: 50 }} />,
    );
    expect(edited).toContain('value="80"');
    expect(edited).not.toContain('value="50"');
    const empty = renderToStaticMarkup(<SetSheet {...props} initial={null} defaults={null} />);
    expect(empty).toContain('value=""');
    expect(empty).toMatch(/<button[^>]*disabled=""[^>]*>Сохранить подход/);
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

  it('preserves an unchanged canonical weight so rounded imperial defaults do not create false records', () => {
    expect(canonicalSetWeight('176.4', 80, 'imperial')).toBe(80);
    expect(canonicalSetWeight('176,4', 80, 'imperial')).toBe(80);
    expect(canonicalSetWeight('80', 80.02, 'metric')).toBe(80.02);
    expect(canonicalSetWeight('177.4', 80, 'imperial')).toBe(80.47);
    expect(canonicalSetWeight('81', 80, 'metric')).toBe(81);
    expect(canonicalSetWeight('176.4', null, 'imperial')).toBe(80.01);
    expect(canonicalSetWeight('80.0', null, 'metric')).toBe(80);
    expect(canonicalSetWeight('', 80, 'metric')).toBeNull();
  });

  it('uses the visual viewport only while the software keyboard covers the focused form', () => {
    expect(
      keyboardViewportStyle({
        focusedInput: true,
        layoutHeight: 844,
        viewportHeight: 510,
        viewportOffsetTop: 0,
      }),
    ).toEqual({ top: '0px', bottom: 'auto', height: '510px' });
    expect(
      keyboardViewportStyle({
        focusedInput: false,
        layoutHeight: 844,
        viewportHeight: 510,
        viewportOffsetTop: 0,
      }),
    ).toBeUndefined();
    expect(
      keyboardViewportStyle({
        focusedInput: true,
        layoutHeight: 844,
        viewportHeight: 800,
        viewportOffsetTop: 0,
      }),
    ).toBeUndefined();
    expect(
      keyboardViewportStyle({
        focusedInput: true,
        layoutHeight: 844,
        viewportHeight: 510,
        viewportOffsetTop: 300,
      }),
    ).toEqual({ top: '300px', bottom: 'auto', height: '510px' });
  });

  it('keeps field reveal scrolling inside the sheet and above sticky actions', () => {
    expect(
      revealScrollDelta({
        fieldTop: 180,
        fieldBottom: 232,
        visibleTop: 16,
        visibleBottom: 350,
      }),
    ).toBe(0);
    expect(
      revealScrollDelta({
        fieldTop: -12,
        fieldBottom: 40,
        visibleTop: 16,
        visibleBottom: 350,
      }),
    ).toBe(-28);
    expect(
      revealScrollDelta({
        fieldTop: 326,
        fieldBottom: 378,
        visibleTop: 16,
        visibleBottom: 350,
      }),
    ).toBe(28);
  });

  it('claims a save synchronously and allows a deliberate retry after failure', () => {
    const lock = { current: false };

    expect(claimSetSubmission(lock)).toBe(true);
    expect(claimSetSubmission(lock)).toBe(false);

    lock.current = false;
    expect(claimSetSubmission(lock)).toBe(true);
  });
});
