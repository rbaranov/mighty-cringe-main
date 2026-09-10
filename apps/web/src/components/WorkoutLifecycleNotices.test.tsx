import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { LocalWorkout } from '../lib/db';
import { PreferencesProvider } from '../lib/preferences';
import { AutoFinishNotice, WorkoutInactivityBanner } from './WorkoutLifecycleNotices';

const workout: LocalWorkout = {
  id: '20000000-0000-4000-8000-000000000001',
  startedAt: '2026-07-30T10:00:00.000Z',
  endedAt: '2026-07-30T11:00:00.000Z',
  durationSeconds: 3_600,
  activeSegmentStartedAt: null,
  lastActivityAt: '2026-07-30T10:45:00.000Z',
  completionReason: 'automatic',
  isFavorite: false,
  favoriteName: null,
  notes: null,
  locale: 'ru',
  exercises: [],
  revision: 1,
  updatedAt: '2026-07-30T12:45:00.000Z',
  syncState: 'synced',
};

describe('workout lifecycle notices', () => {
  it('renders the Russian countdown and both warning actions', () => {
    const html = render(
      'ru',
      <WorkoutInactivityBanner
        onContinue={() => {}}
        onFinish={() => {}}
        state={{ phase: 'warning', remainingSeconds: 754 }}
      />,
    );
    expect(html).toContain('Ещё тренируешься?');
    expect(html).toContain('12:34');
    expect(html).toContain('Да, продолжаю');
    expect(html).toContain('Завершить сейчас');
  });

  it('renders the English auto-finish summary with Continue and Edit', () => {
    const html = render(
      'en',
      <AutoFinishNotice
        onContinue={() => {}}
        onDismiss={() => {}}
        onEdit={() => {}}
        setCount={0}
        workout={workout}
      />,
    );
    expect(html).toContain('Workout finished automatically');
    expect(html).toContain('1 hr');
    expect(html).toContain('0 sets');
    expect(html).toContain('Continue');
    expect(html).toContain('Edit');
  });
});

function render(locale: 'ru' | 'en', children: ReactNode) {
  return renderToStaticMarkup(
    <PreferencesProvider locale={locale} unitSystem="metric">
      {children}
    </PreferencesProvider>,
  );
}
