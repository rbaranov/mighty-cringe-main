import { describe, expect, it } from 'vitest';

import { workoutPlanSchema, type WorkoutExercise } from '@mighty-cringe/contracts';

import {
  addExerciseToWorkoutPlan,
  copyWorkoutPlan,
  createWorkoutPlanFromExercises,
  groupWorkoutPlanForDisplay,
  moveWorkoutPlanExercise,
  replaceExerciseInWorkoutPlan,
  toggleWorkoutGroupLink,
} from './workoutPlan';

function item(position: number, group: number | null): WorkoutExercise {
  return {
    id: `20000000-0000-4000-8000-${String(position + 1).padStart(12, '0')}`,
    exerciseId: `10000000-0000-4000-8000-${String(position + 1).padStart(12, '0')}`,
    position,
    supersetGroup: group,
  };
}

describe('workout groups', () => {
  it('creates and edits a not-started workout plan without logging a workout', () => {
    const ids = [
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003',
    ];
    const exercises = [item(0, null), item(1, null)].map((entry) => ({ id: entry.exerciseId }));
    const created = createWorkoutPlanFromExercises(exercises, () => ids.shift()!);
    const added = addExerciseToWorkoutPlan(created, item(2, null).exerciseId, () => ids.shift()!);
    const replaced = replaceExerciseInWorkoutPlan(
      added,
      added[1].id,
      '10000000-0000-4000-8000-000000000099',
    );
    const moved = moveWorkoutPlanExercise(replaced, replaced[2].id, -1);

    expect(created.map((entry) => entry.supersetGroup)).toEqual([1, 1]);
    expect(added[2]).toMatchObject({ position: 2, supersetGroup: null });
    expect(replaced[1].exerciseId).toBe('10000000-0000-4000-8000-000000000099');
    expect(moved.map((entry) => entry.exerciseId)).toEqual([
      item(0, null).exerciseId,
      item(2, null).exerciseId,
      '10000000-0000-4000-8000-000000000099',
    ]);
    expect(moved.map((entry) => entry.position)).toEqual([0, 1, 2]);
  });

  it('builds distinct display blocks for standalone exercises and one block per linked group', () => {
    const plan = [
      item(0, null),
      item(1, 1),
      item(2, 1),
      item(3, 2),
      item(4, 2),
      item(5, 2),
      item(6, null),
    ].map((entry) => ({ item: entry, label: `Exercise ${entry.position + 1}` }));

    expect(
      groupWorkoutPlanForDisplay(plan).map((group) => ({
        supersetGroup: group.supersetGroup,
        labels: group.entries.map((entry) => entry.label),
      })),
    ).toEqual([
      { supersetGroup: null, labels: ['Exercise 1'] },
      { supersetGroup: 1, labels: ['Exercise 2', 'Exercise 3'] },
      { supersetGroup: 2, labels: ['Exercise 4', 'Exercise 5', 'Exercise 6'] },
      { supersetGroup: null, labels: ['Exercise 7'] },
    ]);
  });

  it('copies the ordered plan with new item ids and preserved group boundaries', () => {
    const ids = ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'];
    const copied = copyWorkoutPlan([item(1, 7), item(0, 7)], () => ids.shift()!);

    expect(copied.map((entry) => entry.id)).toEqual([
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
    ]);
    expect(copied.map((entry) => entry.position)).toEqual([0, 1]);
    expect(copied.map((entry) => entry.supersetGroup)).toEqual([1, 1]);
  });

  it('extends a superset into a triset and quadriset', () => {
    const pair = [item(0, 1), item(1, 1), item(2, null), item(3, null)];
    const triset = toggleWorkoutGroupLink(pair, pair[1].id);
    const quadriset = toggleWorkoutGroupLink(triset, triset[2].id);

    expect(triset.map((entry) => entry.supersetGroup)).toEqual([1, 1, 1, null]);
    expect(quadriset.map((entry) => entry.supersetGroup)).toEqual([1, 1, 1, 1]);
  });

  it('splits a long group at the selected boundary without invalid single-item groups', () => {
    const group = [item(0, 1), item(1, 1), item(2, 1), item(3, 1)];

    expect(toggleWorkoutGroupLink(group, group[1].id).map((entry) => entry.supersetGroup)).toEqual([
      1, 1, 2, 2,
    ]);
    expect(toggleWorkoutGroupLink(group, group[0].id).map((entry) => entry.supersetGroup)).toEqual([
      null,
      1,
      1,
      1,
    ]);
  });
});

describe('exercise ordering', () => {
  it.each<{
    name: string;
    groups: (number | null)[];
    source: number;
    direction: -1 | 1;
    expectedOrder: number[];
  }>([
    {
      name: 'within a superset',
      groups: [1, 1, 2, 2, 3, 3],
      source: 0,
      direction: 1,
      expectedOrder: [1, 0, 2, 3, 4, 5],
    },
    {
      name: 'up between three supersets',
      groups: [1, 1, 2, 2, 3, 3],
      source: 4,
      direction: -1,
      expectedOrder: [0, 1, 2, 4, 3, 5],
    },
    {
      name: 'down between three supersets',
      groups: [1, 1, 2, 2, 3, 3],
      source: 3,
      direction: 1,
      expectedOrder: [0, 1, 2, 4, 3, 5],
    },
    {
      name: 'from a standalone position into a superset',
      groups: [1, 1, null],
      source: 2,
      direction: -1,
      expectedOrder: [0, 2, 1],
    },
    {
      name: 'from a superset into a standalone position',
      groups: [null, 1, 1],
      source: 1,
      direction: -1,
      expectedOrder: [1, 0, 2],
    },
    {
      name: 'between a triset and a quadriset',
      groups: [1, 1, 1, 2, 2, 2, 2],
      source: 3,
      direction: -1,
      expectedOrder: [0, 1, 3, 2, 4, 5, 6],
    },
  ])(
    'preserves group boundaries when swapping $name',
    ({ groups, source, direction, expectedOrder }) => {
      const plan = groups.map((group, position) => item(position, group));
      const original = structuredClone(plan);

      const moved = moveWorkoutPlanExercise(plan, plan[source].id, direction);

      expect(moved.map((entry) => entry.id)).toEqual(expectedOrder.map((index) => plan[index].id));
      expect(moved.map((entry) => entry.exerciseId)).toEqual(
        expectedOrder.map((index) => plan[index].exerciseId),
      );
      expect(moved.map((entry) => entry.supersetGroup)).toEqual(groups);
      expect(moved.map((entry) => entry.position)).toEqual(plan.map((entry) => entry.position));
      expect(workoutPlanSchema.safeParse(moved).success).toBe(true);
      expect(plan).toEqual(original);
    },
  );

  it('can move the fifth exercise to the top and back without breaking any superset', () => {
    const plan = [1, 1, 2, 2, 3, 3].map((group, position) => item(position, group));
    const exercise = plan[4];
    let moved = plan;

    for (let step = 0; step < 4; step += 1) {
      moved = moveWorkoutPlanExercise(moved, exercise.id, -1);
      expect(moved.map((entry) => entry.supersetGroup)).toEqual([1, 1, 2, 2, 3, 3]);
    }
    expect(moved.map((entry) => entry.id)).toEqual(
      [4, 0, 1, 2, 3, 5].map((index) => plan[index].id),
    );
    for (let step = 0; step < 4; step += 1) {
      moved = moveWorkoutPlanExercise(moved, exercise.id, 1);
    }

    expect(moved).toEqual(plan);
  });

  it('uses stored positions when the incoming plan array is unordered', () => {
    const plan = [1, 1, 2, 2].map((group, position) => item(position, group));
    const moved = moveWorkoutPlanExercise([plan[3], plan[1], plan[0], plan[2]], plan[2].id, -1);

    expect(moved.map((entry) => entry.id)).toEqual([0, 2, 1, 3].map((index) => plan[index].id));
    expect(moved.map((entry) => entry.supersetGroup)).toEqual([1, 1, 2, 2]);
  });

  it('keeps the plan intact for an absent item or a move outside the list', () => {
    const plan = [item(0, 1), item(1, 1), item(2, null)];

    expect(moveWorkoutPlanExercise(plan, 'missing', -1)).toEqual(plan);
    expect(moveWorkoutPlanExercise(plan, plan[0].id, -1)).toEqual(plan);
    expect(moveWorkoutPlanExercise(plan, plan[2].id, 1)).toEqual(plan);
  });
});
