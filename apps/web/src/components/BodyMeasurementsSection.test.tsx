import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { LocalMeasurement } from '../lib/db';
import { BodyMeasurementsSection } from './BodyMeasurementsSection';

describe('BodyMeasurementsSection', () => {
  it('renders trends and source detail with deltas against the previous entry', () => {
    const measurements = [
      measurement('older', '2026-01-22T06:00:00.000Z', 82, 91),
      measurement('newer', '2026-06-13T06:00:00.000Z', 80.5, 88.5),
    ];
    const html = renderToStaticMarkup(
      <BodyMeasurementsSection
        measurements={measurements}
        onDelete={() => {}}
        onImport={async () => {}}
        onSave={async () => {}}
      />,
    );

    expect(html).toContain('Замеры и вес');
    expect(html).toContain('Вся история замеров');
    expect(html).toContain('80,5 кг');
    expect(html).toContain('−1,5 кг');
    expect(html).toContain('% жира');
    expect(html).toContain('23,3 %');
    expect(html).toContain('примерная оценка RFM');
    expect(html).toContain('мужская формула');
    expect(html).toContain('Самозамер');
    expect(html).toContain('Изменить');
    expect(html).toContain('Удалить');
  });
});

function measurement(
  id: string,
  measuredOn: string,
  weightKg: number,
  waistCm: number,
): LocalMeasurement {
  return {
    id,
    measuredOn,
    isSelfMeasured: true,
    values: {
      heightCm: id === 'older' ? 180 : null,
      weightKg,
      neckCm: null,
      chestCm: 102,
      bicepsCm: null,
      thighLeftCm: null,
      thighRightCm: null,
      calfCm: null,
      waistCm,
      bodyFatPercent: null,
      rfmSex: id === 'older' ? 'male' : null,
    },
    revision: 1,
    updatedAt: measuredOn,
    syncState: 'synced',
    deleted: false,
  };
}
