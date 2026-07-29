import type { WorkoutExercise } from '@mighty-cringe/contracts';

import type { NaturalWorkoutCommand } from './naturalWorkoutCommand';

export type WorkoutPlanDisplayGroup<T> = {
  supersetGroup: number | null;
  entries: T[];
};

export function groupWorkoutPlanForDisplay<
  T extends { item: Pick<WorkoutExercise, 'supersetGroup'> },
>(entries: T[]): WorkoutPlanDisplayGroup<T>[] {
  const groups: WorkoutPlanDisplayGroup<T>[] = [];

  for (const entry of entries) {
    const supersetGroup = entry.item.supersetGroup;
    const previous = groups.at(-1);
    if (
      supersetGroup === null ||
      previous === undefined ||
      previous.supersetGroup !== supersetGroup
    ) {
      groups.push({ supersetGroup, entries: [entry] });
      continue;
    }
    previous.entries.push(entry);
  }

  return groups;
}

export function copyWorkoutPlan(
  plan: WorkoutExercise[],
  createId: () => string = () => crypto.randomUUID(),
): WorkoutExercise[] {
  return normalizeWorkoutPlan(
    [...plan]
      .sort((left, right) => left.position - right.position)
      .map((item) => ({
        id: createId(),
        exerciseId: item.exerciseId,
        position: item.position,
        supersetGroup: item.supersetGroup,
      })),
  );
}

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
    return normalizeWorkoutPlan(ordered.filter((item) => item.id !== command.source.item.id));
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
    source.supersetGroup = null;
  }
  const anchorIndex = ordered.findIndex((item) => item.id === command.anchor.item.id);
  if (anchorIndex < 0) return normalizeWorkoutPlan([...ordered, source]);
  ordered.splice(anchorIndex + (command.placement === 'after' ? 1 : 0), 0, source);
  return normalizeWorkoutPlan(ordered);
}

export function toggleWorkoutGroupLink(plan: WorkoutExercise[], itemId: string) {
  const ordered = normalizeWorkoutPlan(plan).map((item) => ({ ...item }));
  const index = ordered.findIndex((item) => item.id === itemId);
  const current = ordered[index];
  const following = ordered[index + 1];
  if (!current || !following) return ordered;

  if (current.supersetGroup !== null && current.supersetGroup === following.supersetGroup) {
    const group = current.supersetGroup;
    const left = ordered.filter(
      (item) => item.supersetGroup === group && item.position <= current.position,
    );
    const right = ordered.filter(
      (item) => item.supersetGroup === group && item.position >= following.position,
    );
    const rightGroup = Math.max(0, ...ordered.map((item) => item.supersetGroup ?? 0)) + 1;
    for (const item of left) item.supersetGroup = left.length >= 2 ? group : null;
    for (const item of right) item.supersetGroup = right.length >= 2 ? rightGroup : null;
    return normalizeWorkoutPlan(ordered);
  }

  const targetGroup =
    current.supersetGroup ??
    following.supersetGroup ??
    Math.max(0, ...ordered.map((item) => item.supersetGroup ?? 0)) + 1;
  const mergedGroups = new Set(
    [current.supersetGroup, following.supersetGroup].filter(
      (group): group is number => group !== null,
    ),
  );
  for (const item of ordered) {
    if (mergedGroups.has(item.supersetGroup ?? -1)) item.supersetGroup = targetGroup;
  }
  current.supersetGroup = targetGroup;
  following.supersetGroup = targetGroup;
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
