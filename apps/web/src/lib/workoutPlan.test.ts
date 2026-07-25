import { describe, expect, it } from 'vitest';

import type { WorkoutExercise } from '@mighty-cringe/contracts';

import { toggleWorkoutGroupLink } from './workoutPlan';

function item(position: number, group: number | null): WorkoutExercise {
  return {
    id: `20000000-0000-4000-8000-${String(position + 1).padStart(12, '0')}`,
    exerciseId: `10000000-0000-4000-8000-${String(position + 1).padStart(12, '0')}`,
    position,
    supersetGroup: group,
  };
}

describe('workout groups', () => {
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
