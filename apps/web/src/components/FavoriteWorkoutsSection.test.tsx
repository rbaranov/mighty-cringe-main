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
          onRepeat={() => {}}
          workouts={[workout]}
        />
      </PreferencesProvider>,
    );

    expect(html).toContain('Избранные тренировки');
    expect(html).toContain('Жим лёжа');
    expect(html).toContain('>Повторить<');
    expect(html).toContain('aria-label="Убрать тренировку из избранного"');
    expect(html).toContain('data-icon="favorite-star"');
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
