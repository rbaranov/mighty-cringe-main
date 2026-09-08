import { describe, expect, it } from 'vitest';

import { nextSetPosition } from './setPosition';

describe('nextSetPosition', () => {
  it('assigns consecutive positions within one exercise and ignores unrelated rows', () => {
    const existing = [
      { exerciseId: 'bench', position: 0, deleted: false },
      { exerciseId: 'row', position: 8, deleted: false },
      { exerciseId: 'bench', position: 9, deleted: true },
      { exerciseId: 'bench', position: 1, deleted: false },
    ];

    expect(nextSetPosition(existing, 'bench')).toBe(2);
    expect(nextSetPosition(existing, 'row')).toBe(9);
    expect(nextSetPosition(existing, 'squat')).toBe(0);
  });

  it('sees a newly persisted set before assigning the next position', () => {
    const existing: Array<{ exerciseId: string; position: number; deleted: boolean }> = [];
    const firstPosition = nextSetPosition(existing, 'bench');
    existing.push({ exerciseId: 'bench', position: firstPosition, deleted: false });

    expect(firstPosition).toBe(0);
    expect(nextSetPosition(existing, 'bench')).toBe(1);
  });
});
