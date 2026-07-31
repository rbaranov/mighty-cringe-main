import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { LocalWorkout } from '../lib/db';
import { PreferencesProvider } from '../lib/preferences';
import { WorkoutTimingSheet } from './WorkoutTimingSheet';

const workout: LocalWorkout = {
  id: '20000000-0000-4000-8000-000000000001',
  startedAt: '2026-07-30T10:00:00.000Z',
  endedAt: '2026-07-30T11:30:00.000Z',
  durationSeconds: 5_400,
  activeSegmentStartedAt: null,
  lastActivityAt: '2026-07-30T11:15:00.000Z',
  completionReason: 'automatic',
  isFavorite: false,
  notes: null,
  locale: 'ru',
  exercises: [],
  revision: 1,
  updatedAt: '2026-07-30T12:00:00.000Z',
  syncState: 'synced',
};

describe('WorkoutTimingSheet', () => {
  it('renders Russian timing fields and a derived end', () => {
    const html = render('ru');
    expect(html).toContain('Дата и длительность');
    expect(html).toContain('Дата начала');
    expect(html).toContain('Время начала');
    expect(html).toContain('Окончание:');
    expect(html).toContain('value="1"');
    expect(html).toContain('value="30"');
  });

  it('renders English timing fields and validation range', () => {
    const html = render('en');
    expect(html).toContain('Date and duration');
    expect(html).toContain('Start date');
    expect(html).toContain('Start time');
    expect(html).toContain('Ends:');
  });
});

function render(locale: 'ru' | 'en') {
  return renderToStaticMarkup(
    <PreferencesProvider locale={locale} unitSystem="metric">
      <WorkoutTimingSheet onClose={() => {}} onSave={() => {}} workout={workout} />
    </PreferencesProvider>,
  );
}
