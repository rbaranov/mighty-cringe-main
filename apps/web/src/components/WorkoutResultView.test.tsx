import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Exercise } from '@mighty-cringe/contracts';
import type { LocalSet, LocalWorkout } from '../lib/db';
import { PreferencesProvider } from '../lib/preferences';
import { WorkoutResultView } from './WorkoutResultView';

const exercise: Exercise = {
  id: 'bench',
  nameRu: 'Жим лёжа',
  nameEn: 'Bench press',
  aliases: [],
  primaryMuscles: ['chest'],
  secondaryMuscles: [],
  equipment: ['barbell'],
  tag: 'normal',
};
function workout(id: string, startedAt: string): LocalWorkout {
  return {
    id,
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + 3600000).toISOString(),
    durationSeconds: 3600,
    activeSegmentStartedAt: null,
    lastActivityAt: startedAt,
    completionReason: 'manual',
    isFavorite: false,
    favoriteName: null,
    notes: null,
    locale: 'ru',
    revision: 0,
    updatedAt: startedAt,
    exercises: [],
    syncState: 'pending',
  };
}
function set(id: string, session: LocalWorkout, reps: number): LocalSet {
  return {
    id,
    workoutId: session.id,
    exerciseId: exercise.id,
    weightKg: 80,
    reps,
    rir: 1,
    comment: null,
    performedAt: session.startedAt,
    position: 0,
    entrySource: 'manual',
    revision: 0,
    updatedAt: session.startedAt,
    syncState: 'pending',
    deleted: false,
  };
}
const previous = workout('previous', '2026-10-01T12:00:00Z');
const current = workout('current', '2026-10-07T12:00:00Z');
function render(workouts: LocalWorkout[], sets: LocalSet[], english = false) {
  return renderToStaticMarkup(
    <PreferencesProvider
      locale={english ? 'en' : 'ru'}
      unitSystem={english ? 'imperial' : 'metric'}
    >
      <WorkoutResultView
        workout={current}
        workouts={workouts}
        sets={sets}
        exercises={[exercise]}
        onDone={() => {}}
        onOpenWorkout={() => {}}
        onProgress={() => {}}
        onFavorite={() => {}}
      />
    </PreferencesProvider>,
  );
}

describe('WorkoutResultView', () => {
  it('shows a first workout as a baseline and accurately labels local-only data', () => {
    const html = render([current], [set('current-set', current, 8)]);
    expect(html).toContain('Первый результат — точка отсчёта');
    expect(html).toContain('ожидает синхронизации');
    expect(html).not.toContain('Новые рекорды');
    expect(html).toContain('Жим лёжа');
    expect(html).toContain('Открыть тренировку');
  });
  it('shows source-backed same-weight gains and labels estimated records', () => {
    const html = render(
      [current, previous],
      [set('old-set', previous, 8), set('new-set', current, 10)],
    );
    expect(html).toContain('Новые рекорды');
    expect(html).toContain('8 → 10 повт.');
    expect(html).toContain('Исходный подход');
    expect(html).toContain('не проверенный максимальный вес');
  });
  it('does not celebrate an empty completed workout', () => {
    const html = render([current], []);
    expect(html).toContain('не увеличивает статистику и серию');
    expect(html).not.toContain('Новые рекорды');
  });
  it('keeps a small stored weight improvement visible rather than showing equal endpoints', () => {
    const html = render(
      [current, previous],
      [set('old-set', previous, 8), { ...set('new-set', current, 8), weightKg: 80.01 }],
    );
    expect(html).toContain('80 кг → 80,01 кг');
    expect(html).toContain('80,01 кг');
    expect(html).not.toContain('80 кг → 80 кг');
  });
  it('uses profile language and units in the result', () => {
    const html = render([current], [set('current-set', current, 8)], true);
    expect(html).toContain('Workout complete');
    expect(html).toContain('Bench press');
    expect(html).toContain('176.4 lb');
    expect(html).not.toContain('Жим лёжа');
  });
  it('does not call a pending set deletion synchronized', () => {
    const syncedWorkout = { ...current, syncState: 'synced' as const };
    const deleted = { ...set('deleted', current, 8), deleted: true };
    const html = renderToStaticMarkup(
      <WorkoutResultView
        workout={syncedWorkout}
        workouts={[syncedWorkout]}
        sets={[deleted]}
        exercises={[exercise]}
        onDone={() => {}}
        onOpenWorkout={() => {}}
        onProgress={() => {}}
        onFavorite={() => {}}
      />,
    );
    expect(html).toContain('ожидает синхронизации');
    expect(html).not.toContain('Сохранено и синхронизировано');
    expect(html).toContain('Подходов пока нет');
  });
});
