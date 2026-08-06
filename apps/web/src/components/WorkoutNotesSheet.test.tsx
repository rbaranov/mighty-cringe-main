import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { LocalWorkout } from '../lib/db';
import { PreferencesProvider } from '../lib/preferences';
import { WorkoutNotesSheet } from './WorkoutNotesSheet';

describe('WorkoutNotesSheet', () => {
  it('shows the existing workout-wide note and explicit sheet actions', () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider locale="ru" unitSystem="metric">
        <WorkoutNotesSheet onClose={() => {}} onSave={async () => {}} workout={workout} />
      </PreferencesProvider>,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('Комментарий по тренировке');
    expect(html).toContain('Тренировка прошла бодро.');
    expect(html).toContain('Сохранить');
    expect(html).toContain('Отмена');
  });

  it('renders nothing while the sheet is closed', () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider locale="ru" unitSystem="metric">
        <WorkoutNotesSheet onClose={() => {}} onSave={async () => {}} workout={null} />
      </PreferencesProvider>,
    );

    expect(html).toBe('');
  });
});

const workout: LocalWorkout = {
  id: '20000000-0000-4000-8000-000000000001',
  startedAt: '2026-07-21T17:00:00.000Z',
  endedAt: '2026-07-21T18:00:00.000Z',
  durationSeconds: 3_600,
  activeSegmentStartedAt: null,
  lastActivityAt: '2026-07-21T18:00:00.000Z',
  completionReason: 'manual',
  isFavorite: false,
  notes: 'Тренировка прошла бодро.',
  locale: 'ru',
  revision: 2,
  updatedAt: '2026-07-21T18:00:00.000Z',
  exercises: [],
  syncState: 'synced',
};
