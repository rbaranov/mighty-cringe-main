import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Exercise } from '@mighty-cringe/contracts';

import type { LocalSet, LocalWorkout } from '../lib/db';
import { PreferencesProvider } from '../lib/preferences';
import { ProgressView, type ProgressSection } from './ProgressView';

const exercise: Exercise = {
  id: 'bench',
  nameRu: 'Жим лёжа',
  nameEn: 'Bench press',
  aliases: [],
  tag: 'mighty',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['triceps'],
  equipment: ['barbell'],
};

function workout(id = 'workout', day = '2026-07-21'): LocalWorkout {
  return {
    id,
    startedAt: `${day}T17:00:00.000Z`,
    endedAt: `${day}T18:00:00.000Z`,
    durationSeconds: 3600,
    activeSegmentStartedAt: null,
    lastActivityAt: `${day}T17:45:00.000Z`,
    completionReason: 'automatic',
    isFavorite: true,
    favoriteName: 'Силовая грудь',
    notes: 'Мало спал, но рабочие веса шли уверенно.',
    locale: 'ru',
    revision: 1,
    updatedAt: `${day}T18:00:00.000Z`,
    exercises: [],
    syncState: 'synced',
  };
}
function set(workoutId = 'workout', overrides: Partial<LocalSet> = {}): LocalSet {
  return {
    id: `set-${workoutId}`,
    workoutId,
    exerciseId: exercise.id,
    weightKg: 80,
    reps: 8,
    rir: 2,
    comment: null,
    entrySource: 'voice_ai',
    performedAt: '2026-07-21T17:30:00.000Z',
    position: 0,
    revision: 1,
    updatedAt: '2026-07-21T17:30:00.000Z',
    syncState: 'synced',
    deleted: false,
    ...overrides,
  };
}
function view(
  workouts = [workout()],
  sets = [set()],
  initialSection: ProgressSection = 'strength',
) {
  return (
    <ProgressView
      initialSection={initialSection}
      exercises={[exercise]}
      measurements={[]}
      onDeleteMeasurement={() => {}}
      onDeleteWorkout={() => {}}
      onEditFavoriteName={() => {}}
      onEditWorkout={() => {}}
      onImportMeasurements={async () => {}}
      onRepeatWorkout={() => {}}
      onResumeWorkout={() => {}}
      onSaveMeasurement={async () => {}}
      onToggleFavorite={() => {}}
      onShowWorkoutResult={() => {}}
      sets={sets}
      workouts={workouts}
    />
  );
}

describe('ProgressView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('opens strength directly with accessible sections, source sets, all-time records and an honest baseline', () => {
    const html = renderToStaticMarkup(view());
    expect(html).toContain('role="tablist"');
    expect(html).toContain(
      'id="progress-tab-strength" aria-controls="progress-panel-strength" aria-selected="true"',
    );
    expect(html).toContain('role="tabpanel" id="progress-panel-strength"');
    expect(html).not.toContain('Календарь тренировок');
    expect(html).not.toContain('id="body-heading"');
    expect(html).toContain('30 дней');
    expect(html).toContain('90 дней');
    expect(html).toContain('Всё время');
    expect(html).toContain('Исходные подходы');
    expect(html).toContain('80 кг × 8');
    expect(html).toContain('AI: голос');
    expect(html).toContain('источник 1RM');
    expect(html).toContain('Итог тренировки');
    expect(html).toContain('Открыть тренировку');
    expect(html).toContain('Личные рекорды');
    expect(html).toContain('Максимальный вес');
    expect(html).toContain('Первая тренировка задаёт точку отсчёта');
    expect(html).toContain('сравнивать пока не с чем');
    expect(html).toContain('Epley');
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuenow="1"');
    expect(html).toContain('Предыдущая тренировка на графике');
  });

  it('keeps history actions, workout notes, favorite names and source labels in the history section', () => {
    const html = renderToStaticMarkup(view(undefined, undefined, 'history'));
    expect(html).toContain('Календарь тренировок');
    expect(html).toContain('80 кг×8');
    expect(html).toContain('завершена автоматически');
    expect(html).toContain('Мало спал, но рабочие веса шли уверенно.');
    expect(html).toContain('Силовая грудь');
    expect(html).toContain('AI: голос');
    expect(html).toContain('Редактировать');
    expect(html).toContain('Продолжить');
    expect(html).toContain('Повторить');
    expect(html).toContain('aria-label="Убрать тренировку из избранного"');
    expect(html).toContain('data-icon="favorite-star"');
    expect(html).toContain('Итог');
    expect(html).not.toContain('role="slider"');
  });

  it('retains the full period and every original valid set, excluding deleted and malformed data', () => {
    const workouts = Array.from({ length: 16 }, (_, index) =>
      workout(`w-${index}`, `2026-07-${String(index + 10).padStart(2, '0')}`),
    );
    const sets = workouts.map((item, index) =>
      set(item.id, { weightKg: 60 + index, performedAt: item.startedAt }),
    );
    sets.push(
      set('w-15', {
        id: 'second-set',
        weightKg: 72,
        reps: 10,
        comment: 'Полная амплитуда',
        entrySource: 'manual',
        position: 1,
      }),
    );
    sets.push(set('w-15', { id: 'deleted', weightKg: 999, deleted: true }));
    sets.push(set('w-15', { id: 'invalid', weightKg: NaN }));
    const html = renderToStaticMarkup(view(workouts, sets));
    expect((html.match(/data-workout-id=/gu) ?? []).length).toBe(16);
    expect(html).toContain('aria-valuemax="16"');
    expect(html).toContain('aria-valuenow="16"');
    expect(html).toContain('75 кг × 8');
    expect(html).toContain('72 кг × 10');
    expect(html).toContain('Полная амплитуда');
    expect(html).toContain('Вручную');
    expect(html).not.toContain('999');
    expect(html).not.toContain('NaN');
    // The expandable history contains all 16 workouts, independently of chart points.
    expect((html.match(/<time dateTime="2026-07-/gu) ?? []).length).toBe(16);
  });

  it('keeps earlier records visible while chart and source select only workouts in the current period', () => {
    const html = renderToStaticMarkup(
      view(
        [workout('old', '2026-05-01'), workout('recent')],
        [set('old', { weightKg: 100 }), set('recent', { weightKg: 70 })],
      ),
    );
    expect(html).toContain('data-workout-id="recent"');
    expect(html).not.toContain('data-workout-id="old"');
    expect(html).toContain('100 кг');
    expect(html).toContain('70 кг × 8');
    expect(html).toContain('За всё время');
  });

  it('compares against the previous equal period and renders imperial weights in English', () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider locale="en" unitSystem="imperial">
        {view(
          [workout('before', '2026-06-15'), workout('recent')],
          [
            set('before', { weightKg: 80, reps: 5, rir: null }),
            set('recent', { weightKg: 100, reps: 5, rir: null }),
          ],
        )}
      </PreferencesProvider>,
    );
    expect(html).toContain('Bench press');
    expect(html).toContain('220.5 lb × 5');
    expect(html).toContain('vs the previous 30 days');
    expect(html).toContain('Best estimated 1RM: +51.4 lb');
    expect(html).toContain('Maximum weight');
  });

  it('keeps measurements entry and import in the measurements section', () => {
    const html = renderToStaticMarkup(view([], [], 'measurements'));
    expect(html).toContain('role="tabpanel" id="progress-panel-measurements"');
    expect(html).toContain('Замеры и вес');
    expect(html).toContain('Импорт таблицы');
    expect(html).toContain('+ Замер');
    expect(html).not.toContain('Календарь тренировок');
    expect(html).not.toContain('role="slider"');
  });

  it('keeps precise stored load visible in the source sets and record card', () => {
    const html = renderToStaticMarkup(view([workout()], [set('workout', { weightKg: 80.01 })]));
    expect(html).toContain('80,01 кг × 8');
    expect(html).toContain('<strong>80,01 кг</strong>');
  });

  it('opens history on the current month even when the latest workout is older', () => {
    vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z'));
    const html = renderToStaticMarkup(view([workout()], [], 'history'));
    expect(html).toContain('тренировки в августе');
    expect(html).toContain('0 за 2026 год');
    expect(html).toContain('август 2026');
    expect(html).toContain('aria-label="Следующий месяц" disabled=""');
    expect(html).toContain('В этом месяце пока нет завершённых тренировок.');
  });
});
