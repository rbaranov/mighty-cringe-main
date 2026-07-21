import type { MeasurementValues } from '@mighty-cringe/contracts';

import type { LocalMeasurement } from './db';

export type MeasurementKey = keyof MeasurementValues;

export type MeasurementDefinition = {
  key: MeasurementKey;
  label: string;
  shortLabel: string;
  unit: 'кг' | 'см';
  help: string;
  featured: boolean;
  maximum: number;
};

export type MeasurementImportRow = {
  line: number;
  dateKey: string;
  isSelfMeasured: boolean;
  values: MeasurementValues;
};

export type MeasurementImportResult = {
  rows: MeasurementImportRow[];
  errors: string[];
};

export const measurementDefinitions: MeasurementDefinition[] = [
  {
    key: 'heightCm',
    label: 'Рост',
    shortLabel: 'Рост',
    unit: 'см',
    help: 'Стоя прямо, без обуви.',
    featured: false,
    maximum: 300,
  },
  {
    key: 'weightKg',
    label: 'Вес',
    shortLabel: 'Вес',
    unit: 'кг',
    help: 'Вес тела в одинаковых условиях измерения.',
    featured: true,
    maximum: 500,
  },
  {
    key: 'neckCm',
    label: 'Шея',
    shortLabel: 'Шея',
    unit: 'см',
    help: 'Самое узкое место ниже кадыка.',
    featured: false,
    maximum: 200,
  },
  {
    key: 'chestCm',
    label: 'Грудь',
    shortLabel: 'Грудь',
    unit: 'см',
    help: 'На уровне подмышек, руки свободно опущены.',
    featured: true,
    maximum: 300,
  },
  {
    key: 'bicepsCm',
    label: 'Бицепс',
    shortLabel: 'Бицепс',
    unit: 'см',
    help: 'Локоть согнут на 90°, мышца не напряжена.',
    featured: true,
    maximum: 150,
  },
  {
    key: 'thighLeftCm',
    label: 'Бедро · левое',
    shortLabel: 'Левое бедро',
    unit: 'см',
    help: 'Стоя, расслабленно, лента на середине бедра.',
    featured: false,
    maximum: 200,
  },
  {
    key: 'thighRightCm',
    label: 'Бедро · правое',
    shortLabel: 'Правое бедро',
    unit: 'см',
    help: 'Стоя, расслабленно, лента на середине бедра.',
    featured: false,
    maximum: 200,
  },
  {
    key: 'calfCm',
    label: 'Икра',
    shortLabel: 'Икра',
    unit: 'см',
    help: 'Стоя, в самом широком месте.',
    featured: false,
    maximum: 150,
  },
  {
    key: 'waistCm',
    label: 'Живот / талия',
    shortLabel: 'Талия',
    unit: 'см',
    help: 'Самое широкое место ниже пупка.',
    featured: true,
    maximum: 300,
  },
];

export function orderedMeasurements(measurements: LocalMeasurement[]): LocalMeasurement[] {
  return measurements
    .filter((measurement) => !measurement.deleted)
    .slice()
    .sort(
      (left, right) =>
        left.measuredOn.localeCompare(right.measuredOn) ||
        left.updatedAt.localeCompare(right.updatedAt),
    );
}

export function previousMeasurement(
  measurements: LocalMeasurement[],
  measurementId: string,
): LocalMeasurement | null {
  const ordered = orderedMeasurements(measurements);
  const index = ordered.findIndex((measurement) => measurement.id === measurementId);
  return index > 0 ? ordered[index - 1] : null;
}

export function measurementDelta(
  current: LocalMeasurement,
  previous: LocalMeasurement | null,
  key: MeasurementKey,
): number | null {
  const currentValue = current.values[key];
  const previousValue = previous?.values[key];
  if (currentValue === null || previousValue === null || previousValue === undefined) return null;
  return currentValue - previousValue;
}

export function measurementTrend(
  measurements: LocalMeasurement[],
  key: MeasurementKey,
): Array<{ measurementId: string; measuredOn: string; value: number }> {
  return orderedMeasurements(measurements).flatMap((measurement) => {
    const value = measurement.values[key];
    return value === null
      ? []
      : [{ measurementId: measurement.id, measuredOn: measurement.measuredOn, value }];
  });
}

export function parseMeasurementCsv(text: string): MeasurementImportResult {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2) {
    return { rows: [], errors: ['Нужны строка заголовков и хотя бы одна строка данных.'] };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delimiter).map(normalizeHeader);
  const dateIndex = headers.findIndex((header) => dateHeaders.has(header));
  if (dateIndex < 0) return { rows: [], errors: ['Не найдена обязательная колонка «Дата».'] };
  const selfMeasuredIndex = headers.findIndex((header) => selfMeasuredHeaders.has(header));
  const valueColumns = headers.flatMap((header, index) => {
    const key = measurementHeaderAliases[header];
    return key ? [{ index, key }] : [];
  });
  if (!valueColumns.length) {
    return { rows: [], errors: ['Не найдены колонки замеров: Вес, Рост, Талия и другие.'] };
  }

  const rows: MeasurementImportRow[] = [];
  const errors: string[] = [];
  const seenDates = new Set<string>();
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const lineNumber = lineIndex + 1;
    const cells = splitCsvLine(lines[lineIndex], delimiter);
    const dateKey = parseDateKey(cells[dateIndex]?.trim() ?? '');
    if (!dateKey) {
      errors.push(`Строка ${lineNumber}: дата должна быть в формате ДД.ММ.ГГГГ или ГГГГ-ММ-ДД.`);
      continue;
    }
    if (seenDates.has(dateKey)) {
      errors.push(`Строка ${lineNumber}: дата ${dateKey} повторяется в файле.`);
      continue;
    }
    seenDates.add(dateKey);

    const values = emptyMeasurementValues();
    let invalidValue = false;
    for (const column of valueColumns) {
      const raw = cells[column.index]?.trim() ?? '';
      if (!raw) continue;
      const value = Number(raw.replace(',', '.').replace(/\s*(кг|см)$/i, ''));
      const definition = measurementDefinitions.find((item) => item.key === column.key)!;
      if (!Number.isFinite(value) || value <= 0 || value > definition.maximum) {
        errors.push(
          `Строка ${lineNumber}: «${definition.label}» должно быть числом от 0 до ${definition.maximum}.`,
        );
        invalidValue = true;
        break;
      }
      values[column.key] = value;
    }
    if (invalidValue) continue;
    if (!Object.values(values).some((value) => value !== null)) {
      errors.push(`Строка ${lineNumber}: нет ни одного заполненного замера.`);
      continue;
    }

    rows.push({
      line: lineNumber,
      dateKey,
      isSelfMeasured: selfMeasuredIndex < 0 || parseBoolean(cells[selfMeasuredIndex]?.trim() ?? ''),
      values,
    });
  }
  return { rows, errors };
}

function emptyMeasurementValues(): MeasurementValues {
  return Object.fromEntries(
    measurementDefinitions.map((definition) => [definition.key, null]),
  ) as MeasurementValues;
}

function detectDelimiter(header: string): string {
  if (header.includes('\t')) return '\t';
  return (header.match(/;/g)?.length ?? 0) >= (header.match(/,/g)?.length ?? 0) ? ';' : ',';
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  cells.push(current);
  return cells;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/[().]/g, '')
    .replace(/[\s/-]+/g, '_');
}

function parseDateKey(value: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const local = /^(\d{2})[./-](\d{2})[./-](\d{4})$/.exec(value);
  const dateKey = iso ? value : local ? `${local[3]}-${local[2]}-${local[1]}` : null;
  if (!dateKey) return null;
  const date = new Date(`${dateKey}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey
    ? null
    : dateKey;
}

function parseBoolean(value: string): boolean {
  return ['1', 'true', 'yes', 'да', 'самозамер', '+'].includes(value.toLocaleLowerCase('ru-RU'));
}

const dateHeaders = new Set(['date', 'дата', 'measured_on', 'measuredon']);
const selfMeasuredHeaders = new Set([
  'self_measured',
  'самозамер',
  'самостоятельно',
  'is_self_measured',
]);
const measurementHeaderAliases: Record<string, MeasurementKey> = {
  height: 'heightCm',
  height_cm: 'heightCm',
  рост: 'heightCm',
  рост_см: 'heightCm',
  weight: 'weightKg',
  weight_kg: 'weightKg',
  вес: 'weightKg',
  вес_кг: 'weightKg',
  neck: 'neckCm',
  neck_cm: 'neckCm',
  шея: 'neckCm',
  chest: 'chestCm',
  chest_cm: 'chestCm',
  грудь: 'chestCm',
  biceps: 'bicepsCm',
  biceps_cm: 'bicepsCm',
  бицепс: 'bicepsCm',
  thigh_left: 'thighLeftCm',
  left_thigh: 'thighLeftCm',
  бедро_левое: 'thighLeftCm',
  левое_бедро: 'thighLeftCm',
  бедро_л: 'thighLeftCm',
  thigh_right: 'thighRightCm',
  right_thigh: 'thighRightCm',
  бедро_правое: 'thighRightCm',
  правое_бедро: 'thighRightCm',
  бедро_п: 'thighRightCm',
  calf: 'calfCm',
  calf_cm: 'calfCm',
  икра: 'calfCm',
  waist: 'waistCm',
  waist_cm: 'waistCm',
  belly: 'waistCm',
  талия: 'waistCm',
  живот: 'waistCm',
  живот_талия: 'waistCm',
};
