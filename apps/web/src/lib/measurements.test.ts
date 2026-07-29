import { describe, expect, it } from 'vitest';

import type { LocalMeasurement } from './db';
import {
  measurementDelta,
  measurementTrend,
  orderedMeasurements,
  parseMeasurementCsv,
  previousMeasurement,
  resolvedMeasurementValue,
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

  it('uses a manual body-fat value first and otherwise inherits the latest height and sex for RFM', () => {
    const estimatedOlder = {
      ...older,
      values: { ...older.values, heightCm: 180, rfmSex: 'male' as const },
    };
    const manual = {
      ...newer,
      values: { ...newer.values, bodyFatPercent: 18.2 },
    };

    expect(resolvedMeasurementValue(newer, 'bodyFatPercent', [newer, estimatedOlder])).toEqual({
      value: 23.3,
      source: 'rfm-estimate',
      rfmSex: 'male',
    });
    expect(resolvedMeasurementValue(manual, 'bodyFatPercent')).toEqual({
      value: 18.2,
      source: 'recorded',
    });
    expect(measurementTrend([newer, estimatedOlder], 'bodyFatPercent')).toEqual([
      { measurementId: 'older', measuredOn: older.measuredOn, value: 24.4 },
      { measurementId: 'newer', measuredOn: newer.measuredOn, value: 23.3 },
    ]);
    expect(
      measurementDelta(newer, estimatedOlder, 'bodyFatPercent', [newer, estimatedOlder]),
    ).toBeCloseTo(-1.1);
  });

  it('supports the female RFM formula and lets values on the current entry override inherited ones', () => {
    const latestReference = {
      ...newer,
      values: { ...newer.values, heightCm: 190, rfmSex: 'female' as const },
    };
    expect(resolvedMeasurementValue(older, 'bodyFatPercent', [older, latestReference])).toEqual({
      value: 34.2,
      source: 'rfm-estimate',
      rfmSex: 'female',
    });

    const explicitCurrent = {
      ...older,
      values: { ...older.values, heightCm: 180, rfmSex: 'male' as const },
    };
    expect(
      resolvedMeasurementValue(explicitCurrent, 'bodyFatPercent', [
        explicitCurrent,
        latestReference,
      ]),
    ).toEqual({
      value: 24.4,
      source: 'rfm-estimate',
      rfmSex: 'male',
    });
  });

  it('keeps body fat unavailable until waist, a latest height and a latest sex exist', () => {
    const withoutInputs = {
      ...newer,
      values: { ...newer.values, heightCm: 180, waistCm: null, rfmSex: 'male' as const },
    };
    expect(resolvedMeasurementValue(withoutInputs, 'bodyFatPercent')).toEqual({
      value: null,
      source: 'unavailable',
    });
    expect(
      resolvedMeasurementValue(newer, 'bodyFatPercent', [
        newer,
        { ...older, values: { ...older.values, heightCm: 180 } },
      ]),
    ).toEqual({
      value: null,
      source: 'unavailable',
    });
  });

  it('skips undefined legacy fields while inheriting height and sex for RFM', () => {
    const reference = {
      ...older,
      values: { ...older.values, heightCm: 180, rfmSex: 'male' as const },
    };
    const legacy = {
      ...newer,
      id: 'legacy',
      values: {
        ...newer.values,
        heightCm: undefined,
        rfmSex: undefined,
      } as unknown as LocalMeasurement['values'],
    };
    const target = {
      ...newer,
      id: 'target',
      measuredOn: '2027-01-22T06:00:00.000Z',
      values: { ...newer.values, heightCm: null, rfmSex: null },
    };

    expect(resolvedMeasurementValue(target, 'bodyFatPercent', [reference, legacy, target])).toEqual(
      {
        value: 23.3,
        source: 'rfm-estimate',
        rfmSex: 'male',
      },
    );
  });

  it('imports semicolon CSV with Russian headers, decimal commas and historic dates', () => {
    const result = parseMeasurementCsv(
      [
        'Дата;Вес;Процент жира;Грудь;Бедро левое;Бедро правое;Талия;Пол;Самозамер',
        '23.03.2025;82,5;18,5;103;57;57,5;91;мужской;да',
        '2026-01-22;80,2;;101;;;;;нет',
      ].join('\n'),
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      dateKey: '2025-03-23',
      isSelfMeasured: true,
      values: {
        weightKg: 82.5,
        bodyFatPercent: 18.5,
        thighRightCm: 57.5,
        waistCm: 91,
        rfmSex: 'male',
      },
    });
  });

  it('understands descriptive rows with dates across columns', () => {
    const result = parseMeasurementCsv(
      [
        'Повторные замеры:,23.03.2025,13.06.2025,06.08.2025,11.09.2025,22.01.2026',
        '⁃ Объем шеи (в самом узком месте ниже кадыка),41,"41,5","39,5",40,40',
        '⁃ Грудь. Измеряется подмышками при расслабленном состоянии.,108,109,112,"110,5","110,5"',
        '"⁃ Бицепс. Измеряется при согнутом предплечье на 90°, без напряжения.","35,5","38,5","38,5",38,"38,5"',
        '"⁃ Бедро (одно). Стоя, расслабленно, с лентой на середине бедра.",Л63 П60,Л66 П62,"Л62,5 П58,5","Л62 П58,5",Л64 П62',
        '⁃ Икра. В самом широком месте.,"43,5","43,5","42,5",42,43',
        '⁃ Живот. В самом широком месте ниже пупка.,106,"102,5","100 (почти 98,5)","98,5",96',
        '- Вес,"96,8",96,95,"91,6","91,5"',
        ',,,,,самозамер',
      ].join('\n'),
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(5);
    expect(result.rows[0]).toMatchObject({
      dateKey: '2025-03-23',
      isSelfMeasured: false,
      values: {
        weightKg: 96.8,
        neckCm: 41,
        chestCm: 108,
        bicepsCm: 35.5,
        thighLeftCm: 63,
        thighRightCm: 60,
        calfCm: 43.5,
        waistCm: 106,
      },
    });
    expect(result.rows[2]?.values.waistCm).toBe(100);
    expect(result.rows[4]).toMatchObject({
      dateKey: '2026-01-22',
      isSelfMeasured: true,
      values: { thighLeftCm: 64, thighRightCm: 62, weightKg: 91.5, waistCm: 96 },
    });
  });

  it('finds a pasted TSV table after notes and honors units in headers', () => {
    const result = parseMeasurementCsv(
      [
        'Export from another app',
        '',
        'Date\tWeight lb\tWaist in',
        'March 23, 2025\t182\t35.8',
      ].join('\n'),
      { locale: 'en', unitSystem: 'metric' },
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      dateKey: '2025-03-23',
      values: { weightKg: 82.55, waistCm: 90.93 },
    });
  });

  it('rejects a duplicate date in a table with dates across columns', () => {
    const result = parseMeasurementCsv(['Замеры,23.03.2025,23.03.2025', 'Вес,82,81'].join('\n'));

    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual(['Строка 1: дата 2025-03-23 повторяется в файле.']);
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
      bodyFatPercent: null,
      rfmSex: null,
    },
    revision: 1,
    updatedAt: measuredOn,
    syncState: 'synced',
    deleted: false,
  };
}
