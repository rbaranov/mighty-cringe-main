import { describe, expect, it } from 'vitest';

import { inProgressWindow, progressWindow, timestampPosition } from './progressRange';

describe('progress date windows', () => {
  it('includes exactly 30 local calendar days with an adjacent non-overlapping baseline', () => {
    const window = progressWindow(30, '2026-03-31');
    expect(window).toEqual({
      start: '2026-03-02',
      end: '2026-03-31',
      previousStart: '2026-01-31',
      previousEnd: '2026-03-01',
    });
    expect(inProgressWindow('2026-03-02', window)).toBe(true);
    expect(inProgressWindow('2026-03-01', window)).toBe(false);
    expect(inProgressWindow('2026-03-01', window, true)).toBe(true);
    expect(inProgressWindow('2026-03-02', window, true)).toBe(false);
    expect(inProgressWindow('2026-04-01', window)).toBe(false);
  });

  it('handles 90-day year boundaries and all-time without inventing a previous period', () => {
    expect(progressWindow(90, '2026-01-01').start).toBe('2025-10-04');
    const all = progressWindow('all', '2026-01-01');
    expect(inProgressWindow('2020-01-01', all)).toBe(true);
    expect(inProgressWindow('2026-01-02', all)).toBe(false);
    expect(inProgressWindow('2025-01-01', all, true)).toBe(false);
  });

  it('preserves real date gaps and same-day workout spacing', () => {
    expect(
      timestampPosition('2026-07-02T00:00:00Z', '2026-07-01T00:00:00Z', '2026-07-11T00:00:00Z'),
    ).toBe(0.1);
    expect(
      timestampPosition('2026-07-01T12:00:00Z', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z'),
    ).toBe(0.5);
    expect(
      timestampPosition('2026-07-01T12:00:00Z', '2026-07-01T12:00:00Z', '2026-07-01T12:00:00Z'),
    ).toBe(0.5);
  });
});
