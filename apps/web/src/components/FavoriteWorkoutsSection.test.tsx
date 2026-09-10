import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Exercise } from '@mighty-cringe/contracts';

import type { LocalWorkout } from '../lib/db';
import { PreferencesProvider } from '../lib/preferences';
import { FavoriteWorkoutsSection } from './FavoriteWorkoutsSection';

describe('FavoriteWorkoutsSection', () => {
  it('shows a bookmarked workout with a direct repeat and safe removal action', () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider locale="ru" unitSystem="metric">
        <FavoriteWorkoutsSection
          exercises={[exercise]}
          onRemove={() => {}}
          onRename={() => {}}
          onRepeat={() => {}}
          workouts={[workout]}
        />
      </PreferencesProvider>,
    );

    expect(html).toContain('Избранные тренировки');
    expect(html).toContain('Грудь и трицепс');
    expect(html).toContain('Жим лёжа');
    expect(html).toContain('1 упражнение');
    expect(html).toContain('>Изменить название<');
    expect(html).toContain('>Повторить<');
    expect(html).toContain('>Убрать из избранного<');
    expect(html).toContain('aria-label="Действия с избранной тренировкой"');
    expect(html).toContain('aria-haspopup="true"');
    expect(html).toContain('role="button"');
  });

  it('keeps the date as a clear fallback for an existing unnamed favorite', () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider locale="ru" unitSystem="metric">
        <FavoriteWorkoutsSection
          exercises={[exercise]}
          onRemove={() => {}}
          onRename={() => {}}
          onRepeat={() => {}}
          workouts={[{ ...workout, favoriteName: null }]}
        />
      </PreferencesProvider>,
    );

    expect(html).toContain('2026');
    expect(html).toContain('Жим лёжа');
  });

  it('keeps a long list compact until the athlete asks to show every favorite', () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider locale="ru" unitSystem="metric">
        <FavoriteWorkoutsSection
          exercises={[exercise]}
          onRemove={() => {}}
          onRename={() => {}}
          onRepeat={() => {}}
          workouts={[
            workout,
            { ...workout, id: '20000000-0000-4000-8000-000000000002', favoriteName: 'Спина' },
            { ...workout, id: '20000000-0000-4000-8000-000000000003', favoriteName: 'Ноги' },
          ]}
        />
      </PreferencesProvider>,
    );

    expect(html).toContain('Грудь и трицепс');
    expect(html).toContain('Спина');
    expect(html).not.toContain('Ноги');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('>Показать все<');
  });

  it('previews only two exercise names and reports the rest', () => {
    const secondExercise = {
      ...exercise,
      id: '10000000-0000-4000-8000-000000000002',
      nameRu: 'Тяга блока',
    };
    const thirdExercise = {
      ...exercise,
      id: '10000000-0000-4000-8000-000000000003',
      nameRu: 'Приседания',
    };
    const html = renderToStaticMarkup(
      <PreferencesProvider locale="ru" unitSystem="metric">
        <FavoriteWorkoutsSection
          exercises={[exercise, secondExercise, thirdExercise]}
          onRemove={() => {}}
          onRename={() => {}}
          onRepeat={() => {}}
          workouts={[
            {
              ...workout,
              exercises: [
                workout.exercises[0],
                {
                  ...workout.exercises[0],
                  id: '21000000-0000-4000-8000-000000000002',
                  exerciseId: secondExercise.id,
                  position: 1,
                },
                {
                  ...workout.exercises[0],
                  id: '21000000-0000-4000-8000-000000000003',
                  exerciseId: thirdExercise.id,
                  position: 2,
                },
              ],
            },
          ]}
        />
      </PreferencesProvider>,
    );

    expect(html).toContain('Жим лёжа · Тяга блока · ещё 1');
    expect(html).not.toContain('Приседания');
    expect(html).toContain('3 упражнения');
  });
});

const exercise: Exercise = {
  id: '10000000-0000-4000-8000-000000000001',
  nameRu: 'Жим лёжа',
  nameEn: 'Bench press',
  aliases: [],
  tag: 'mighty',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['triceps'],
  equipment: ['barbell'],
};

const workout: LocalWorkout = {
  id: '20000000-0000-4000-8000-000000000001',
  startedAt: '2026-07-21T17:00:00.000Z',
  endedAt: '2026-07-21T18:00:00.000Z',
  durationSeconds: 3_600,
  activeSegmentStartedAt: null,
  lastActivityAt: '2026-07-21T18:00:00.000Z',
  completionReason: 'manual',
  isFavorite: true,
  favoriteName: 'Грудь и трицепс',
  notes: null,
  locale: 'ru',
  revision: 1,
  updatedAt: '2026-07-21T18:00:00.000Z',
  exercises: [
    {
      id: '21000000-0000-4000-8000-000000000001',
      exerciseId: exercise.id,
      position: 0,
      supersetGroup: null,
    },
  ],
  syncState: 'synced',
};
