import type { LocalSet } from './db';

type PositionedSet = Pick<LocalSet, 'deleted' | 'exerciseId' | 'position'>;

export function nextSetPosition(sets: PositionedSet[], exerciseId: string) {
  return (
    Math.max(
      -1,
      ...sets
        .filter((set) => set.exerciseId === exerciseId && !set.deleted)
        .map((set) => set.position),
    ) + 1
  );
}
