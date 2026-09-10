import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { LocalWorkout } from '../lib/db';
import { PreferencesProvider } from '../lib/preferences';
import { WorkoutFavoriteNameSheet } from './WorkoutFavoriteNameSheet';

describe('WorkoutFavoriteNameSheet', () => {
  it('offers an optional name while adding a workout to favorites', () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider locale="ru" unitSystem="metric">
        <WorkoutFavoriteNameSheet onClose={() => {}} onSave={async () => {}} workout={workout} />
      </PreferencesProvider>,
    );

    expect(html).toContain('Добавить тренировку в избранное');
    expect(html).toContain('Название необязательно');
    expect(html).toContain('maxLength="60"');
    expect(html).toContain('>В избранное<');
  });

  it('shows the current name when editing an existing favorite', () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider locale="ru" unitSystem="metric">
        <WorkoutFavoriteNameSheet
          onClose={() => {}}
          onSave={async () => {}}
          workout={{ ...workout, isFavorite: true, favoriteName: 'День ног' }}
        />
      </PreferencesProvider>,
    );

    expect(html).toContain('Изменить название избранной тренировки');
    expect(html).toContain('value="День ног"');
    expect(html).toContain('>Сохранить<');
  });
});

const workout: LocalWorkout = {
  id: '20000000-0000-4000-8000-000000000001',
  startedAt: '2026-09-10T06:00:00.000Z',
  endedAt: '2026-09-10T07:00:00.000Z',
  durationSeconds: 3_600,
  activeSegmentStartedAt: null,
  lastActivityAt: '2026-09-10T07:00:00.000Z',
  completionReason: 'manual',
  isFavorite: false,
  favoriteName: null,
  notes: null,
  locale: 'ru',
  revision: 2,
  updatedAt: '2026-09-10T07:00:00.000Z',
  exercises: [],
  syncState: 'synced',
};
