import { describe, expect, it } from 'vitest';

import type { WorkoutExercise } from '@mighty-cringe/contracts';

import { fallbackCatalog } from './fallbackCatalog';
import { buildSuggestedExercises } from './workoutSuggestions';

function plan(ids: string[]): WorkoutExercise[] {
  return ids.map((exerciseId, position) => ({
    id: `20000000-0000-4000-8000-${String(position + 1).padStart(12, '0')}`,
    exerciseId,
    position,
    supersetGroup: Math.floor(position / 2) + 1,
  }));
}

describe('workout suggestions', () => {
  it('keeps a suggestion stable for the same history and day', () => {
    const input = {
      catalog: fallbackCatalog,
      workouts: [],
      today: new Date(2026, 6, 26, 10),
    };

    expect(buildSuggestedExercises(input).map((exercise) => exercise.id)).toEqual(
      buildSuggestedExercises(input).map((exercise) => exercise.id),
    );
  });

  it('rotates available exercises away from the latest completed workout', () => {
    const first = buildSuggestedExercises({
      catalog: fallbackCatalog,
      workouts: [],
      today: new Date(2026, 6, 26, 10),
    });
    const next = buildSuggestedExercises({
      catalog: fallbackCatalog,
      workouts: [
        {
          id: '30000000-0000-4000-8000-000000000001',
          endedAt: '2026-07-26T11:00:00.000Z',
          exercises: plan(first.map((exercise) => exercise.id)),
        },
      ],
      today: new Date(2026, 6, 26, 12),
    });

    expect(next.map((exercise) => exercise.id)).not.toEqual(first.map((exercise) => exercise.id));
    expect(
      next.filter((exercise) => !first.some((previous) => previous.id === exercise.id)),
    ).not.toHaveLength(0);
  });

  it('never suggests disliked exercises or reintroduces them as fallback', () => {
    const allowed = fallbackCatalog[0]!;
    const preferences = new Map(
      fallbackCatalog
        .filter((exercise) => exercise.id !== allowed.id)
        .map((exercise) => [exercise.id, 'dislike' as const]),
    );

    const result = buildSuggestedExercises({
      catalog: fallbackCatalog,
      workouts: [],
      preferences,
      today: new Date(2026, 7, 5, 10),
    });

    expect(result).toEqual([allowed]);
  });

  it('does not promote liked exercises in the automatic starting plan', () => {
    const today = new Date(2026, 7, 5, 10);
    const baseline = buildSuggestedExercises({
      catalog: fallbackCatalog,
      workouts: [],
      today,
    });
    const liked = fallbackCatalog.find(
      (exercise) => !baseline.some((suggested) => suggested.id === exercise.id),
    );
    expect(liked).toBeDefined();

    const withLike = buildSuggestedExercises({
      catalog: fallbackCatalog,
      workouts: [],
      preferences: new Map([[liked!.id, 'like']]),
      today,
    });

    expect(withLike.map((exercise) => exercise.id)).toEqual(
      baseline.map((exercise) => exercise.id),
    );
  });
});
