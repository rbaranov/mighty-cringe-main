import { describe, expect, it } from 'vitest';

import type { LocalMeasurement } from './db';
import {
  measurementDelta,
  measurementTrend,
  orderedMeasurements,
  parseMeasurementCsv,
  previousMeasurement,
} from './measurements';

const older = measurement('older', '2026-01-22T06:00:00.000Z', 82, 91);
const newer = measurement('newer', '2026-06-13T06:00:00.000Z', 80.5, 88.5);

describe('body measurement history', () => {
  it('sorts history, excluding deleted tombstones', () => {
    const deleted = {
      ...measurement('deleted', '2026-07-01T06:00:00.000Z', 79, 87),
      deleted: true,
    };
    expect(orderedMeasurements([newer, deleted, older]).map((entry) => entry.id)).toEqual([
      'older',
      'newer',
    ]);
  });

  it('calculates detail deltas against the immediately previous entry', () => {
    expect(previousMeasurement([newer, older], newer.id)?.id).toBe(older.id);
    expect(measurementDelta(newer, older, 'weightKg')).toBe(-1.5);
    expect(measurementDelta(newer, older, 'waistCm')).toBe(-2.5);
    expect(measurementDelta(newer, null, 'weightKg')).toBeNull();
  });

  it('builds a chronological trend only from recorded values', () => {
    const withoutWeight = measurement('middle', '2026-03-23T06:00:00.000Z', null, 90);
    expect(measurementTrend([newer, withoutWeight, older], 'weightKg')).toEqual([
      { measurementId: 'older', measuredOn: older.measuredOn, value: 82 },
      { measurementId: 'newer', measuredOn: newer.measuredOn, value: 80.5 },
    ]);
  });

  it('imports semicolon CSV with Russian headers, decimal commas and historic dates', () => {
    const result = parseMeasurementCsv(
      [
        'Дата;Вес;Грудь;Бедро левое;Бедро правое;Талия;Самозамер',
        '23.03.2025;82,5;103;57;57,5;91;да',
        '2026-01-22;80,2;101;;;;нет',
      ].join('\n'),
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      dateKey: '2025-03-23',
      isSelfMeasured: true,
      values: { weightKg: 82.5, thighRightCm: 57.5, waistCm: 91 },
    });
  });

  it('rejects duplicate dates and out-of-range values before import', () => {
    const result = parseMeasurementCsv(
      ['date,weight', '2026-01-22,80', '22.01.2026,81', '2026-02-20,900'].join('\n'),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([
      'Строка 3: дата 2026-01-22 повторяется в файле.',
      'Строка 4: «Вес» должно быть числом от 0 до 500.',
    ]);
    expect(result.rows[0]?.isSelfMeasured).toBe(true);
  });
});

function measurement(
  id: string,
  measuredOn: string,
  weightKg: number | null,
  waistCm: number | null,
): LocalMeasurement {
  return {
    id,
    measuredOn,
    isSelfMeasured: true,
    values: {
      heightCm: null,
      weightKg,
      neckCm: null,
      chestCm: null,
      bicepsCm: null,
      thighLeftCm: null,
      thighRightCm: null,
      calfCm: null,
      waistCm,
    },
    revision: 1,
    updatedAt: measuredOn,
    syncState: 'synced',
    deleted: false,
  };
}
