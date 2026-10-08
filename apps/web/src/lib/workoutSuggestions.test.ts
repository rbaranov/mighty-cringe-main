import { describe, expect, it } from 'vitest';

import type { Exercise, WorkoutExercise } from '@mighty-cringe/contracts';

import { fallbackCatalog } from './fallbackCatalog';
import { buildSuggestedExercises } from './workoutSuggestions';

const muscles: Exercise['primaryMuscles'][number][] = [
  'back',
  'middle_delt',
  'chest',
  'biceps',
  'quadriceps',
  'triceps',
];
const today = new Date(2026, 9, 8, 10);

function exercise(id: string, primaryMuscles: Exercise['primaryMuscles']): Exercise {
  return { ...fallbackCatalog[0]!, id, nameRu: id, nameEn: id, primaryMuscles };
}

const catalog = muscles.flatMap((muscle) => [
  exercise(`${muscle}-familiar`, [muscle]),
  exercise(`${muscle}-alternative`, [muscle]),
]);

function plan(ids: string[]): WorkoutExercise[] {
  return ids.map((exerciseId, position) => ({
    id: `20000000-0000-4000-8000-${String(position + 1).padStart(12, '0')}`,
    exerciseId,
    position,
    supersetGroup: Math.floor(position / 2) + 1,
  }));
}

function completedWorkouts(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `workout-${index}`,
    endedAt: `2026-10-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    exercises: plan(['back-alternative']),
  }));
}

type SuggestionInput = Parameters<typeof buildSuggestedExercises>[0];

function ids(input: SuggestionInput) {
  return buildSuggestedExercises(input).map((item) => item.id);
}

function selectionCount(input: Partial<SuggestionInput>, exerciseId = 'back-familiar') {
  return Array.from({ length: 200 }, (_, index) =>
    ids({ catalog, workouts: [], today, ...input, seed: `sample-${index}` }),
  ).filter((result) => result.includes(exerciseId)).length;
}

describe('workout suggestions', () => {
  it('keeps the default suggestion stable for the same history and local day', () => {
    const input = { catalog: fallbackCatalog, workouts: completedWorkouts(2), today };
    expect(ids(input)).toEqual(ids({ ...input, today: new Date(2026, 9, 8, 23) }));
  });

  it('uses an explicit seed reproducibly and different seeds offer varied plans', () => {
    const input = { catalog, workouts: [], today, seed: 'specific-reroll' };
    expect(ids(input)).toEqual(ids({ ...input, today: new Date(2026, 9, 9) }));
    const plans = new Set(
      Array.from({ length: 12 }, (_, index) =>
        [...ids({ ...input, seed: `reroll-${index}` })].sort().join(','),
      ),
    );
    expect(plans.size).toBeGreaterThan(6);
  });

  it('prefers frequently performed exercises, including those removed from a saved plan', () => {
    const workouts = completedWorkouts(9);
    const sets = workouts.map((workout) => ({
      workoutId: workout.id,
      exerciseId: 'back-familiar',
      deleted: false,
    }));
    const neutralCount = selectionCount({ workouts });
    const familiarCount = selectionCount({ workouts, sets });

    expect(familiarCount).toBeGreaterThan(neutralCount + 40);
    expect(familiarCount).toBeLessThan(200);
    expect(familiarCount).toBeGreaterThan(150);
  });

  it('counts an exercise once per completed workout regardless of the number of sets', () => {
    const workouts = completedWorkouts(2);
    const sets = workouts.map((workout) => ({
      workoutId: workout.id,
      exerciseId: 'back-familiar',
    }));
    for (let index = 0; index < 25; index += 1) {
      const input = { catalog, workouts, today, seed: `deduplicated-${index}` };
      expect(ids({ ...input, sets })).toEqual(ids({ ...input, sets: [...sets, ...sets, ...sets] }));
    }
  });

  it('does not infer frequency from planned exercises, deleted sets, active or missing workouts', () => {
    const workouts = [
      ...completedWorkouts(5),
      { id: 'active', endedAt: null, exercises: plan(['back-familiar']) },
    ];
    const sets = [
      ...workouts.map((workout) => ({
        workoutId: workout.id,
        exerciseId: 'back-familiar',
        deleted: true,
      })),
      { workoutId: 'active', exerciseId: 'back-familiar' },
      { workoutId: 'missing', exerciseId: 'back-familiar' },
    ];
    for (let index = 0; index < 25; index += 1) {
      const input = { catalog, workouts, today, seed: `unused-plans-${index}` };
      expect(ids({ ...input, sets })).toEqual(
        ids({ ...input, workouts: workouts.map((workout) => ({ ...workout, exercises: [] })) }),
      );
    }
  });

  it('gives liked exercises better odds without making them mandatory', () => {
    const neutralCount = selectionCount({});
    const likedCount = selectionCount({ preferences: new Map([['back-familiar', 'like']]) });
    expect(likedCount).toBeGreaterThan(neutralCount + 40);
    expect(likedCount).toBeLessThan(200);
  });

  it('prefers exercises from saved favorites even if the favorite has no performed sets', () => {
    const workouts = [
      { id: 'saved', endedAt: null, exercises: plan(['back-familiar']), isFavorite: true },
    ];
    const neutralCount = selectionCount({ workouts: [{ ...workouts[0]!, isFavorite: false }] });
    const favoriteCount = selectionCount({ workouts });
    expect(favoriteCount).toBeGreaterThan(neutralCount + 40);
    expect(favoriteCount).toBeLessThan(200);
    expect(
      selectionCount({
        workouts: [{ ...workouts[0]!, exercises: plan(['back-familiar', 'back-familiar']) }],
      }),
    ).toBe(favoriteCount);
  });

  it('never reintroduces disliked exercises, even familiar favorites or fallback choices', () => {
    const allowed = catalog[0]!;
    const workouts = completedWorkouts(2).map((workout) => ({
      ...workout,
      exercises: plan(catalog.map((item) => item.id)),
      isFavorite: true,
    }));
    const sets = catalog.map((item) => ({ workoutId: workouts[0]!.id, exerciseId: item.id }));
    const preferences = new Map(
      catalog.filter((item) => item.id !== allowed.id).map((item) => [item.id, 'dislike' as const]),
    );
    const input = {
      catalog,
      workouts,
      sets,
      preferences,
      today,
      previousExerciseIds: [allowed.id],
    };
    expect(buildSuggestedExercises(input)).toEqual([allowed]);
    expect(
      buildSuggestedExercises({
        ...input,
        preferences: new Map(catalog.map((item) => [item.id, 'dislike'])),
      }),
    ).toEqual([]);
  });

  it('generates six distinct movements covering the usual muscles without any history', () => {
    for (let index = 0; index < 30; index += 1) {
      const result = buildSuggestedExercises({
        catalog,
        workouts: [],
        today,
        seed: `cold-${index}`,
      });
      expect(result).toHaveLength(6);
      expect(new Set(result.map((item) => item.id)).size).toBe(6);
      expect(new Set(result.flatMap((item) => item.primaryMuscles))).toEqual(new Set(muscles));
    }
  });

  it('rerolls to different membership while preserving available muscle coverage', () => {
    for (let index = 0; index < 30; index += 1) {
      const input = { catalog, workouts: [], today, seed: `force-different-${index}` };
      const previousExerciseIds = ids(input);
      // Reuse the seed to exercise the fallback when weighted selection repeats the same plan.
      const next = buildSuggestedExercises({ ...input, previousExerciseIds });
      expect(next).toHaveLength(6);
      expect(new Set(next.map((item) => item.id)).size).toBe(6);
      expect(new Set(next.map((item) => item.id))).not.toEqual(new Set(previousExerciseIds));
      expect(new Set(next.flatMap((item) => item.primaryMuscles))).toEqual(new Set(muscles));
    }
  });

  it('can reroll when the only alternative belongs to another muscle group', () => {
    const limitedCatalog = [
      ...muscles.map((muscle) => exercise(muscle, [muscle])),
      exercise('calves-alternative', ['calves']),
    ];
    const input = { catalog: limitedCatalog, workouts: [], today, seed: 'limited-alternatives' };
    const previousExerciseIds = ids(input);
    const next = ids({ ...input, previousExerciseIds });
    expect(next).toHaveLength(6);
    expect(new Set(next)).not.toEqual(new Set(previousExerciseIds));
    expect(next).toContain('calves-alternative');
    expect(next.filter((id) => previousExerciseIds.includes(id))).toHaveLength(5);
  });

  it('keeps every allowed exercise when the catalog has six or fewer instead of shrinking on reroll', () => {
    for (const size of [0, 1, 3, 6]) {
      const limitedCatalog = catalog.slice(0, size);
      const input = { catalog: limitedCatalog, workouts: [], today, seed: 'small-catalog' };
      expect(new Set(ids(input))).toEqual(new Set(limitedCatalog.map((item) => item.id)));
      expect(new Set(ids({ ...input, previousExerciseIds: ids(input) }))).toEqual(
        new Set(ids(input)),
      );
    }
  });

  it('handles overlapping primary muscles and duplicate catalog entries without duplicate selections', () => {
    const overlapping = exercise('back-and-delt', ['back', 'middle_delt']);
    const input = {
      catalog: [overlapping, overlapping, ...catalog],
      workouts: [],
      today,
      preferences: new Map([['back-and-delt', 'like' as const]]),
    };
    for (let index = 0; index < 30; index += 1) {
      const result = buildSuggestedExercises({ ...input, seed: `overlap-${index}` });
      expect(result).toHaveLength(6);
      expect(new Set(result.map((item) => item.id)).size).toBe(6);
      expect(new Set(result.flatMap((item) => item.primaryMuscles))).toEqual(new Set(muscles));
    }
  });

  it('does not mutate input arrays, plans, sets, preferences, or the previous suggestion', () => {
    const workouts = Object.freeze(
      completedWorkouts(2).map((workout) =>
        Object.freeze({
          ...workout,
          exercises: Object.freeze(workout.exercises),
          isFavorite: true,
        }),
      ),
    );
    const sets = Object.freeze([{ workoutId: workouts[0]!.id, exerciseId: 'back-familiar' }]);
    const preferences = new Map([['back-familiar', 'like' as const]]);
    const previousExerciseIds = Object.freeze(catalog.slice(0, 6).map((item) => item.id));
    const input = {
      catalog: Object.freeze([...catalog]),
      workouts,
      sets,
      preferences,
      previousExerciseIds,
      today,
    };
    const before = structuredClone(input);
    buildSuggestedExercises(input);
    expect(input).toEqual(before);
  });
});
