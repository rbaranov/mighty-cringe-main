import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Exercise } from '@mighty-cringe/contracts';

import type { LocalSet, LocalWorkout } from '../lib/db';
import { PreferencesProvider } from '../lib/preferences';
import { ProgressView } from './ProgressView';

describe('ProgressView', () => {
  it('renders source-backed calendar and strength details', () => {
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
    const workout: LocalWorkout = {
      id: '20000000-0000-4000-8000-000000000001',
      startedAt: '2026-07-21T17:00:00.000Z',
      endedAt: '2026-07-21T18:00:00.000Z',
      notes: null,
      locale: 'ru',
      revision: 1,
      updatedAt: '2026-07-21T18:00:00.000Z',
      exercises: [],
      syncState: 'synced',
    };
    const set: LocalSet = {
      id: '30000000-0000-4000-8000-000000000001',
      workoutId: workout.id,
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
    };

    const html = renderToStaticMarkup(
      <ProgressView
        exercises={[exercise]}
        measurements={[]}
        onDeleteMeasurement={() => {}}
        onDeleteWorkout={() => {}}
        onEditWorkout={() => {}}
        onImportMeasurements={async () => {}}
        onResumeWorkout={() => {}}
        onSaveMeasurement={async () => {}}
        sets={[set]}
        workouts={[workout]}
      />,
    );

    expect(html).toContain('Календарь тренировок');
    expect(html).toContain('Текущая серия');
    expect(html).toContain('Личный расчётный рекорд');
    expect(html).toContain('80 кг×8');
    expect(html).toContain('Epley');
    expect(html).toContain('AI: голос');
    expect(html).toContain('Редактировать');
    expect(html).toContain('Продолжить');
  });

  it('renders English catalog names and imperial weights from profile preferences', () => {
    const exercise: Exercise = {
      id: '10000000-0000-4000-8000-000000000003',
      nameRu: 'Жим лёжа',
      nameEn: 'Bench press',
      aliases: [],
      tag: 'mighty',
      primaryMuscles: ['chest'],
      secondaryMuscles: [],
      equipment: [],
    };
    const workout = {
      id: '20000000-0000-4000-8000-000000000001',
      startedAt: '2026-07-21T17:00:00.000Z',
      endedAt: '2026-07-21T18:00:00.000Z',
      notes: null,
      locale: 'en' as const,
      revision: 1,
      updatedAt: '2026-07-21T18:00:00.000Z',
      exercises: [],
      syncState: 'synced' as const,
    };
    const set: LocalSet = {
      id: '30000000-0000-4000-8000-000000000001',
      workoutId: workout.id,
      exerciseId: exercise.id,
      weightKg: 100,
      reps: 5,
      rir: null,
      comment: null,
      entrySource: 'manual',
      performedAt: '2026-07-21T17:30:00.000Z',
      position: 0,
      revision: 1,
      updatedAt: '2026-07-21T17:30:00.000Z',
      syncState: 'synced',
      deleted: false,
    };

    const html = renderToStaticMarkup(
      <PreferencesProvider locale="en" unitSystem="imperial">
        <ProgressView
          exercises={[exercise]}
          measurements={[]}
          onDeleteMeasurement={() => {}}
          onDeleteWorkout={() => {}}
          onEditWorkout={() => {}}
          onImportMeasurements={async () => {}}
          onResumeWorkout={() => {}}
          onSaveMeasurement={async () => {}}
          sets={[set]}
          workouts={[workout]}
        />
      </PreferencesProvider>,
    );

    expect(html).toContain('Workout calendar');
    expect(html).toContain('Bench press');
    expect(html).toContain('220.5 lb×5');
  });
});
