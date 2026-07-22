import type { WorkoutExercise } from '@mighty-cringe/contracts';

import type { NaturalWorkoutCommand } from './naturalWorkoutCommand';

export function applyWorkoutCommandToPlan(
  plan: WorkoutExercise[],
  command: NaturalWorkoutCommand,
  createId: () => string = () => crypto.randomUUID(),
) {
  const ordered = normalizeWorkoutPlan(plan).map((item) => ({ ...item }));

  if (command.type === 'replace') {
    return normalizeWorkoutPlan(
      ordered.map((item) =>
        item.id === command.source.item.id ? { ...item, exerciseId: command.replacement.id } : item,
      ),
    );
  }

  if (command.type === 'remove') {
    const removed = ordered.find((item) => item.id === command.source.item.id);
    const remaining = ordered.filter((item) => item.id !== command.source.item.id);
    if (removed?.supersetGroup !== null && removed?.supersetGroup !== undefined) {
      for (const item of remaining) {
        if (item.supersetGroup === removed.supersetGroup) item.supersetGroup = null;
      }
    }
    return normalizeWorkoutPlan(remaining);
  }

  if (command.type === 'add') {
    const item: WorkoutExercise = {
      id: createId(),
      exerciseId: command.exercise.id,
      position: ordered.length,
      supersetGroup: null,
    };
    if (!command.anchor) return normalizeWorkoutPlan([...ordered, item]);
    const anchorIndex = ordered.findIndex((candidate) => candidate.id === command.anchor?.item.id);
    if (anchorIndex < 0) return normalizeWorkoutPlan([...ordered, item]);
    ordered.splice(anchorIndex + (command.placement === 'after' ? 1 : 0), 0, item);
    return normalizeWorkoutPlan(ordered);
  }

  const sourceIndex = ordered.findIndex((item) => item.id === command.source.item.id);
  if (sourceIndex < 0) return ordered;
  const [source] = ordered.splice(sourceIndex, 1);
  if (source.supersetGroup !== null) {
    const detachedGroup = source.supersetGroup;
    source.supersetGroup = null;
    for (const item of ordered) {
      if (item.supersetGroup === detachedGroup) item.supersetGroup = null;
    }
  }
  const anchorIndex = ordered.findIndex((item) => item.id === command.anchor.item.id);
  if (anchorIndex < 0) return normalizeWorkoutPlan([...ordered, source]);
  ordered.splice(anchorIndex + (command.placement === 'after' ? 1 : 0), 0, source);
  return normalizeWorkoutPlan(ordered);
}

export function normalizeWorkoutPlan(plan: WorkoutExercise[]) {
  const ordered = plan.map((item, position) => ({ ...item, position }));
  const groupPositions = new Map<number, number[]>();
  for (const item of ordered) {
    if (item.supersetGroup === null) continue;
    const positions = groupPositions.get(item.supersetGroup) ?? [];
    positions.push(item.position);
    groupPositions.set(item.supersetGroup, positions);
  }
  const groupNumbers = new Map<number, number>();
  let nextGroup = 1;
  for (const [group, positions] of groupPositions) {
    const consecutive = positions.every(
      (position, index) => index === 0 || position === positions[index - 1] + 1,
    );
    if (positions.length >= 2 && consecutive) groupNumbers.set(group, nextGroup++);
  }
  return ordered.map((item) => ({
    ...item,
    supersetGroup:
      item.supersetGroup === null ? null : (groupNumbers.get(item.supersetGroup) ?? null),
  }));
}
