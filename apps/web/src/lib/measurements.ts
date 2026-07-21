import type { CurrentUser, MeasurementValues, UnitSystem } from '@mighty-cringe/contracts';

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

export function parseMeasurementCsv(
  text: string,
  options: { locale?: CurrentUser['locale']; unitSystem?: UnitSystem } = {},
): MeasurementImportResult {
  const locale = options.locale ?? 'ru';
  const unitSystem = options.unitSystem ?? 'metric';
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2) {
    return {
      rows: [],
      errors: [
        message(
          locale,
          'Нужны строка заголовков и хотя бы одна строка данных.',
          'A header and at least one data row are required.',
        ),
      ],
    };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delimiter).map(normalizeHeader);
  const dateIndex = headers.findIndex((header) => dateHeaders.has(header));
  if (dateIndex < 0) {
    return {
      rows: [],
      errors: [
        message(
          locale,
          'Не найдена обязательная колонка «Дата».',
          'Required “Date” column not found.',
        ),
      ],
    };
  }
  const selfMeasuredIndex = headers.findIndex((header) => selfMeasuredHeaders.has(header));
  const valueColumns = headers.flatMap((header, index) => {
    const key = measurementHeaderAliases[header];
    return key ? [{ index, key }] : [];
  });
  if (!valueColumns.length) {
    return {
      rows: [],
      errors: [
        message(
          locale,
          'Не найдены колонки замеров: Вес, Рост, Талия и другие.',
          'No measurement columns were found: Weight, Height, Waist, and others.',
        ),
      ],
    };
  }

  const rows: MeasurementImportRow[] = [];
  const errors: string[] = [];
  const seenDates = new Set<string>();
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const lineNumber = lineIndex + 1;
    const cells = splitCsvLine(lines[lineIndex], delimiter);
    const dateKey = parseDateKey(cells[dateIndex]?.trim() ?? '');
    if (!dateKey) {
      errors.push(
        message(
          locale,
          `Строка ${lineNumber}: дата должна быть в формате ДД.ММ.ГГГГ или ГГГГ-ММ-ДД.`,
          `Row ${lineNumber}: date must use DD.MM.YYYY or YYYY-MM-DD.`,
        ),
      );
      continue;
    }
    if (seenDates.has(dateKey)) {
      errors.push(
        message(
          locale,
          `Строка ${lineNumber}: дата ${dateKey} повторяется в файле.`,
          `Row ${lineNumber}: date ${dateKey} is duplicated.`,
        ),
      );
      continue;
    }
    seenDates.add(dateKey);

    const values = emptyMeasurementValues();
    let invalidValue = false;
    for (const column of valueColumns) {
      const raw = cells[column.index]?.trim() ?? '';
      if (!raw) continue;
      const unitMatch = raw.match(/\s*(кг|kg|см|cm|lb|lbs|pounds?|in|inch|inches)$/i);
      const displayValue = Number(
        raw.replace(',', '.').replace(/\s*(кг|kg|см|cm|lb|lbs|pounds?|in|inch|inches)$/i, ''),
      );
      const definition = measurementDefinitions.find((item) => item.key === column.key)!;
      const explicitUnit = unitMatch?.[1].toLocaleLowerCase();
      const inputSystem = explicitUnit
        ? ['lb', 'lbs', 'pound', 'pounds', 'in', 'inch', 'inches'].includes(explicitUnit)
          ? 'imperial'
          : 'metric'
        : unitSystem;
      const value = canonicalMeasurementValue(column.key, displayValue, inputSystem);
      if (!Number.isFinite(value) || value <= 0 || value > definition.maximum) {
        const label =
          locale === 'en'
            ? (englishMeasurementLabels[column.key] ?? definition.label)
            : definition.label;
        errors.push(
          message(
            locale,
            `Строка ${lineNumber}: «${label}» должно быть числом от 0 до ${definition.maximum}.`,
            `Row ${lineNumber}: “${label}” must be a positive number in the allowed range.`,
          ),
        );
        invalidValue = true;
        break;
      }
      values[column.key] = value;
    }
    if (invalidValue) continue;
    if (!Object.values(values).some((value) => value !== null)) {
      errors.push(
        message(
          locale,
          `Строка ${lineNumber}: нет ни одного заполненного замера.`,
          `Row ${lineNumber}: no measurements were provided.`,
        ),
      );
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

function canonicalMeasurementValue(key: MeasurementKey, value: number, unitSystem: UnitSystem) {
  if (unitSystem === 'metric') return value;
  const canonical = key === 'weightKg' ? value / 2.2046226218 : value * 2.54;
  return Math.round((canonical + Number.EPSILON) * 100) / 100;
}

function message(locale: CurrentUser['locale'], russian: string, english: string) {
  return locale === 'en' ? english : russian;
}

const englishMeasurementLabels: Partial<Record<MeasurementKey, string>> = {
  heightCm: 'Height',
  weightKg: 'Weight',
  neckCm: 'Neck',
  chestCm: 'Chest',
  bicepsCm: 'Biceps',
  thighLeftCm: 'Left thigh',
  thighRightCm: 'Right thigh',
  calfCm: 'Calf',
  waistCm: 'Waist',
};

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
  height_in: 'heightCm',
  рост: 'heightCm',
  рост_см: 'heightCm',
  рост_in: 'heightCm',
  weight: 'weightKg',
  weight_kg: 'weightKg',
  weight_lb: 'weightKg',
  вес: 'weightKg',
  вес_кг: 'weightKg',
  вес_lb: 'weightKg',
  neck: 'neckCm',
  neck_cm: 'neckCm',
  neck_in: 'neckCm',
  шея: 'neckCm',
  шея_in: 'neckCm',
  chest: 'chestCm',
  chest_cm: 'chestCm',
  chest_in: 'chestCm',
  грудь: 'chestCm',
  грудь_in: 'chestCm',
  biceps: 'bicepsCm',
  biceps_cm: 'bicepsCm',
  biceps_in: 'bicepsCm',
  бицепс: 'bicepsCm',
  бицепс_in: 'bicepsCm',
  thigh_left: 'thighLeftCm',
  left_thigh: 'thighLeftCm',
  left_thigh_in: 'thighLeftCm',
  бедро_левое: 'thighLeftCm',
  бедро_левое_in: 'thighLeftCm',
  левое_бедро: 'thighLeftCm',
  бедро_л: 'thighLeftCm',
  thigh_right: 'thighRightCm',
  right_thigh: 'thighRightCm',
  right_thigh_in: 'thighRightCm',
  бедро_правое: 'thighRightCm',
  бедро_правое_in: 'thighRightCm',
  правое_бедро: 'thighRightCm',
  бедро_п: 'thighRightCm',
  calf: 'calfCm',
  calf_cm: 'calfCm',
  calf_in: 'calfCm',
  икра: 'calfCm',
  икра_in: 'calfCm',
  waist: 'waistCm',
  waist_cm: 'waistCm',
  waist_in: 'waistCm',
  belly: 'waistCm',
  талия: 'waistCm',
  талия_in: 'waistCm',
  живот: 'waistCm',
  живот_талия: 'waistCm',
};
