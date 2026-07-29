import type {
  CurrentUser,
  MeasurementNumericKey,
  MeasurementValues,
  RfmSex,
  UnitSystem,
} from '@mighty-cringe/contracts';

import type { LocalMeasurement } from './db';

export type MeasurementKey = MeasurementNumericKey;

export type MeasurementDefinition = {
  key: MeasurementKey;
  label: string;
  shortLabel: string;
  unit: 'кг' | 'см' | '%';
  help: string;
  featured: boolean;
  maximum: number;
};

export type ResolvedMeasurementValue =
  | { value: number; source: 'recorded' }
  | { value: number; source: 'rfm-estimate'; rfmSex: RfmSex }
  | { value: null; source: 'unavailable' };

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
  {
    key: 'bodyFatPercent',
    label: '% жира',
    shortLabel: '% жира',
    unit: '%',
    help: 'Можно ввести явно. Иначе RFM считается по талии из этой записи и последним указанным ростом и полом.',
    featured: true,
    maximum: 100,
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
  measurements: LocalMeasurement[] = previous ? [previous, current] : [current],
): number | null {
  const currentValue = resolvedMeasurementValue(current, key, measurements).value;
  const previousValue = previous
    ? resolvedMeasurementValue(previous, key, measurements).value
    : null;
  if (currentValue === null || previousValue === null) return null;
  return currentValue - previousValue;
}

export function measurementTrend(
  measurements: LocalMeasurement[],
  key: MeasurementKey,
): Array<{ measurementId: string; measuredOn: string; value: number }> {
  return orderedMeasurements(measurements).flatMap((measurement) => {
    const value = resolvedMeasurementValue(measurement, key, measurements).value;
    return value === null
      ? []
      : [{ measurementId: measurement.id, measuredOn: measurement.measuredOn, value }];
  });
}

export function resolvedMeasurementValue(
  measurement: LocalMeasurement,
  key: MeasurementKey,
  measurements: LocalMeasurement[] = [measurement],
): ResolvedMeasurementValue {
  const recorded = measurement.values[key] ?? null;
  if (recorded !== null) return { value: recorded, source: 'recorded' };
  if (key !== 'bodyFatPercent') return { value: null, source: 'unavailable' };

  const latestFirst = orderedMeasurements(measurements).reverse();
  const heightCm =
    measurement.values.heightCm ??
    latestFirst.find((candidate) => candidate.values.heightCm !== null)?.values.heightCm ??
    null;
  const rfmSex =
    measurement.values.rfmSex ??
    latestFirst.find((candidate) => candidate.values.rfmSex !== null)?.values.rfmSex ??
    null;
  const waistCm = measurement.values.waistCm ?? null;
  if (heightCm === null || waistCm === null || rfmSex === null) {
    return { value: null, source: 'unavailable' };
  }

  const estimate = (rfmSex === 'female' ? 76 : 64) - 20 * (heightCm / waistCm);
  if (!Number.isFinite(estimate) || estimate <= 0 || estimate > 100) {
    return { value: null, source: 'unavailable' };
  }
  return {
    value: Math.round((estimate + Number.EPSILON) * 10) / 10,
    source: 'rfm-estimate',
    rfmSex,
  };
}

export function parseMeasurementCsv(
  text: string,
  options: { locale?: CurrentUser['locale']; unitSystem?: UnitSystem } = {},
): MeasurementImportResult {
  const locale = options.locale ?? 'ru';
  const unitSystem = options.unitSystem ?? 'metric';
  const table = parseDelimitedTable(text.replace(/^\uFEFF/, ''));
  if (table.length < 2) {
    return {
      rows: [],
      errors: [
        message(
          locale,
          'Нужна таблица с датами и хотя бы одним замером.',
          'A table with dates and at least one measurement is required.',
        ),
      ],
    };
  }

  const standardLayout = findStandardLayout(table, locale);
  if (standardLayout) return parseStandardLayout(table, standardLayout, locale, unitSystem);

  const transposedLayout = findTransposedLayout(table, locale);
  if (transposedLayout) return parseTransposedLayout(table, transposedLayout, locale, unitSystem);

  return {
    rows: [],
    errors: [
      message(
        locale,
        'Не удалось найти даты и названия замеров. Можно вставить таблицу, где даты идут по строкам или по столбцам.',
        'Could not find dates and measurement names. Dates may run down rows or across columns.',
      ),
    ],
  };
}

type ParsedTableRow = {
  cells: string[];
  line: number;
};

type MeasurementLabelMatch = {
  keys: MeasurementKey[];
  unitSystem: UnitSystem | null;
};

type StandardLayout = {
  headerIndex: number;
  dateIndex: number;
  selfMeasuredIndex: number;
  rfmSexIndex: number;
  valueColumns: Array<{ index: number; match: MeasurementLabelMatch }>;
};

type TransposedLayout = {
  dateRowIndex: number;
  dates: Array<{ index: number; dateKey: string }>;
};

function parseStandardLayout(
  table: ParsedTableRow[],
  layout: StandardLayout,
  locale: CurrentUser['locale'],
  unitSystem: UnitSystem,
): MeasurementImportResult {
  const rows: MeasurementImportRow[] = [];
  const errors: string[] = [];
  const seenDates = new Set<string>();
  for (let rowIndex = layout.headerIndex + 1; rowIndex < table.length; rowIndex += 1) {
    const source = table[rowIndex];
    const hasValues =
      layout.valueColumns.some(({ index }) => hasMeasurementValue(source.cells[index])) ||
      (layout.rfmSexIndex >= 0 && hasMeasurementValue(source.cells[layout.rfmSexIndex]));
    const rawDate = source.cells[layout.dateIndex]?.trim() ?? '';
    if (!rawDate && !hasValues) continue;

    const dateKey = parseDateKey(rawDate, locale);
    if (!dateKey) {
      errors.push(
        message(
          locale,
          `Строка ${source.line}: не удалось распознать дату «${rawDate || 'пусто'}».`,
          `Row ${source.line}: could not recognize date “${rawDate || 'blank'}”.`,
        ),
      );
      continue;
    }
    if (seenDates.has(dateKey)) {
      errors.push(
        message(
          locale,
          `Строка ${source.line}: дата ${dateKey} повторяется в файле.`,
          `Row ${source.line}: date ${dateKey} is duplicated.`,
        ),
      );
      continue;
    }
    seenDates.add(dateKey);

    const values = emptyMeasurementValues();
    let invalidValue = false;
    for (const column of layout.valueColumns) {
      const raw = source.cells[column.index]?.trim() ?? '';
      const error = assignMeasurementValues(values, column.match, raw, unitSystem, locale);
      if (error) {
        errors.push(
          message(locale, `Строка ${source.line}: ${error.ru}`, `Row ${source.line}: ${error.en}`),
        );
        invalidValue = true;
        break;
      }
    }
    if (invalidValue) continue;
    if (layout.rfmSexIndex >= 0) {
      const rawSex = source.cells[layout.rfmSexIndex]?.trim() ?? '';
      if (hasMeasurementValue(rawSex)) {
        const parsedSex = parseRfmSex(rawSex);
        if (!parsedSex) {
          errors.push(
            message(
              locale,
              `Строка ${source.line}: пол для RFM должен быть «мужской» или «женский».`,
              `Row ${source.line}: RFM sex must be “male” or “female”.`,
            ),
          );
          continue;
        }
        values.rfmSex = parsedSex;
      }
    }
    if (!hasRecordedMeasurement(values)) {
      errors.push(
        message(
          locale,
          `Строка ${source.line}: нет ни одного заполненного замера.`,
          `Row ${source.line}: no measurements were provided.`,
        ),
      );
      continue;
    }

    rows.push({
      line: source.line,
      dateKey,
      isSelfMeasured:
        layout.selfMeasuredIndex < 0 ||
        parseBoolean(source.cells[layout.selfMeasuredIndex]?.trim() ?? ''),
      values,
    });
  }
  return { rows, errors };
}

function parseTransposedLayout(
  table: ParsedTableRow[],
  layout: TransposedLayout,
  locale: CurrentUser['locale'],
  unitSystem: UnitSystem,
): MeasurementImportResult {
  const dateSource = table[layout.dateRowIndex];
  const errors: string[] = [];
  const seenDates = new Set<string>();
  const records = layout.dates.flatMap(({ index, dateKey }) => {
    if (seenDates.has(dateKey)) {
      errors.push(
        message(
          locale,
          `Строка ${dateSource.line}: дата ${dateKey} повторяется в файле.`,
          `Row ${dateSource.line}: date ${dateKey} is duplicated.`,
        ),
      );
      return [];
    }
    seenDates.add(dateKey);
    return [
      {
        columnIndex: index,
        dateKey,
        values: emptyMeasurementValues(),
        isSelfMeasured: false,
        invalid: false,
      },
    ];
  });
  let hasSelfMeasuredMarkers = false;

  for (let rowIndex = 0; rowIndex < table.length; rowIndex += 1) {
    if (rowIndex === layout.dateRowIndex) continue;
    const source = table[rowIndex];
    const label = source.cells
      .slice(0, Math.min(...layout.dates.map(({ index }) => index)))
      .filter(Boolean)
      .join(' ');
    const match = matchMeasurementLabel(label);
    if (match) {
      records.forEach((record) => {
        const raw = source.cells[record.columnIndex]?.trim() ?? '';
        const error = assignMeasurementValues(record.values, match, raw, unitSystem, locale);
        if (!error) return;
        record.invalid = true;
        errors.push(
          message(
            locale,
            `Строка ${source.line}, дата ${record.dateKey}: ${error.ru}`,
            `Row ${source.line}, date ${record.dateKey}: ${error.en}`,
          ),
        );
      });
      continue;
    }

    if (isRfmSexHeader(label)) {
      records.forEach((record) => {
        const raw = source.cells[record.columnIndex]?.trim() ?? '';
        if (!hasMeasurementValue(raw)) return;
        const parsedSex = parseRfmSex(raw);
        if (parsedSex) {
          record.values.rfmSex = parsedSex;
          return;
        }
        record.invalid = true;
        errors.push(
          message(
            locale,
            `Строка ${source.line}, дата ${record.dateKey}: пол для RFM должен быть «мужской» или «женский».`,
            `Row ${source.line}, date ${record.dateKey}: RFM sex must be “male” or “female”.`,
          ),
        );
      });
      continue;
    }

    const explicitSelfMeasuredRow = isSelfMeasuredHeader(label);
    const markerValues = records.map((record) => source.cells[record.columnIndex]?.trim() ?? '');
    const hasStandaloneMarker =
      !label.trim() &&
      markerValues.some(isTrueBooleanMarker) &&
      markerValues.every((value) => !value || isBooleanMarker(value));
    if (!explicitSelfMeasuredRow && !hasStandaloneMarker) continue;
    hasSelfMeasuredMarkers = true;
    records.forEach((record) => {
      const raw = source.cells[record.columnIndex]?.trim() ?? '';
      record.isSelfMeasured = explicitSelfMeasuredRow
        ? parseBoolean(raw)
        : isTrueBooleanMarker(raw);
    });
  }

  if (!hasSelfMeasuredMarkers) {
    records.forEach((record) => {
      record.isSelfMeasured = true;
    });
  }

  const rows = records.flatMap<MeasurementImportRow>((record) => {
    if (record.invalid) return [];
    if (!hasRecordedMeasurement(record.values)) {
      errors.push(
        message(
          locale,
          `Дата ${record.dateKey}: нет ни одного распознанного замера.`,
          `Date ${record.dateKey}: no measurements were recognized.`,
        ),
      );
      return [];
    }
    return [
      {
        line: dateSource.line,
        dateKey: record.dateKey,
        isSelfMeasured: record.isSelfMeasured,
        values: record.values,
      },
    ];
  });

  return { rows, errors };
}

function findStandardLayout(
  table: ParsedTableRow[],
  locale: CurrentUser['locale'],
): StandardLayout | null {
  let best: StandardLayout | null = null;
  for (let headerIndex = 0; headerIndex < table.length; headerIndex += 1) {
    const cells = table[headerIndex].cells;
    const valueColumns = cells.flatMap((label, index) => {
      const match = matchMeasurementLabel(label);
      return match ? [{ index, match }] : [];
    });
    if (!valueColumns.length) continue;

    let dateIndex = cells.findIndex(isDateHeader);
    if (dateIndex < 0) {
      dateIndex = cells.findIndex(
        (label, index) =>
          !label.trim() &&
          table
            .slice(headerIndex + 1, headerIndex + 4)
            .some((row) => parseDateKey(row.cells[index]?.trim() ?? '', locale)),
      );
    }
    if (dateIndex < 0) continue;

    const candidate: StandardLayout = {
      headerIndex,
      dateIndex,
      selfMeasuredIndex: cells.findIndex(isSelfMeasuredHeader),
      rfmSexIndex: cells.findIndex(isRfmSexHeader),
      valueColumns,
    };
    if (!best || candidate.valueColumns.length > best.valueColumns.length) best = candidate;
  }
  return best;
}

function findTransposedLayout(
  table: ParsedTableRow[],
  locale: CurrentUser['locale'],
): TransposedLayout | null {
  let best: TransposedLayout | null = null;
  for (let dateRowIndex = 0; dateRowIndex < table.length; dateRowIndex += 1) {
    const cells = table[dateRowIndex].cells;
    const dates = cells.flatMap((value, index) => {
      const dateKey = parseDateKey(value.trim(), locale);
      return dateKey ? [{ index, dateKey }] : [];
    });
    if (!dates.length || dates[0].index === 0) continue;
    const leadingLabel = cells.slice(0, dates[0].index).join(' ');
    if (dates.length === 1 && !isDateAxisLabel(leadingLabel)) continue;
    if (!best || dates.length > best.dates.length) best = { dateRowIndex, dates };
  }
  return best;
}

function assignMeasurementValues(
  values: MeasurementValues,
  match: MeasurementLabelMatch,
  raw: string,
  defaultUnitSystem: UnitSystem,
  locale: CurrentUser['locale'],
): { ru: string; en: string } | null {
  if (!hasMeasurementValue(raw)) return null;
  const displayValues =
    match.keys.length === 2 ? parsePairedValues(raw) : [parseLocalizedNumber(raw)];
  const inputSystem = unitSystemFromText(raw) ?? match.unitSystem ?? defaultUnitSystem;

  for (let index = 0; index < match.keys.length; index += 1) {
    const displayValue = displayValues[index] ?? null;
    if (displayValue === null && index > 0) continue;
    const key = match.keys[index];
    const definition = measurementDefinitions.find((item) => item.key === key)!;
    const value =
      displayValue === null
        ? Number.NaN
        : canonicalMeasurementValue(key, displayValue, inputSystem);
    if (!Number.isFinite(value) || value <= 0 || value > definition.maximum) {
      const label =
        locale === 'en' ? (englishMeasurementLabels[key] ?? definition.label) : definition.label;
      return {
        ru: `«${label}» должно быть числом от 0 до ${definition.maximum}.`,
        en: `“${label}” must be a positive number in the allowed range.`,
      };
    }
    values[key] = value;
  }
  return null;
}

function canonicalMeasurementValue(key: MeasurementKey, value: number, unitSystem: UnitSystem) {
  if (unitSystem === 'metric' || key === 'bodyFatPercent') return value;
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
  bodyFatPercent: 'Body fat',
};

function emptyMeasurementValues(): MeasurementValues {
  return {
    ...Object.fromEntries(measurementDefinitions.map((definition) => [definition.key, null])),
    rfmSex: null,
  } as MeasurementValues;
}

function hasRecordedMeasurement(values: MeasurementValues): boolean {
  return measurementDefinitions.some((definition) => values[definition.key] !== null);
}

function parseDelimitedTable(text: string): ParsedTableRow[] {
  const candidates = ['\t', ';', ','].map((delimiter) => {
    const rows = splitDelimitedText(text, delimiter).filter((row) =>
      row.cells.some((cell) => cell.trim()),
    );
    const widths = rows.map((row) => row.cells.length).filter((width) => width > 1);
    const frequencies = new Map<number, number>();
    widths.forEach((width) => frequencies.set(width, (frequencies.get(width) ?? 0) + 1));
    const [modeWidth = 1, modeCount = 0] = [...frequencies].sort(
      (left, right) => right[1] - left[1] || right[0] - left[0],
    )[0] ?? [1, 0];
    const score = widths.length * 20 + modeCount * 50 + Math.min(modeWidth, 20) * 2;
    return { rows, score };
  });
  return candidates.sort((left, right) => right.score - left.score)[0].rows;
}

function splitDelimitedText(text: string, delimiter: string): ParsedTableRow[] {
  const rows: ParsedTableRow[] = [];
  let cells: string[] = [];
  let current = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === delimiter && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }
    if ((character === '\n' || character === '\r') && !quoted) {
      cells.push(current);
      rows.push({ cells, line: rowLine });
      cells = [];
      current = '';
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      line += 1;
      rowLine = line;
      continue;
    }
    current += character;
    if (character === '\n') line += 1;
  }
  cells.push(current);
  rows.push({ cells, line: rowLine });
  return rows;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[()[\].,:]/g, '')
    .replace(/[\s/—–-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseDateKey(value: string, locale: CurrentUser['locale'] = 'ru'): string | null {
  const normalized = value.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const iso = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\s|$)/.exec(normalized);
  const local = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:\s|$)/.exec(normalized);
  const dayMonthName = /^(\d{1,2})\s+([a-zа-я]+)\s*,?\s*(\d{4})$/.exec(normalized);
  const monthNameDay = /^([a-z]+)\s+(\d{1,2})\s*,?\s*(\d{4})$/.exec(normalized);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (local) {
    const first = Number(local[1]);
    const second = Number(local[2]);
    year = Number(local[3].length === 2 ? `20${local[3]}` : local[3]);
    month = locale === 'en' && normalized.includes('/') ? first : second;
    day = locale === 'en' && normalized.includes('/') ? second : first;
  } else if (dayMonthName) {
    year = Number(dayMonthName[3]);
    month = monthNames[dayMonthName[2]] ?? 0;
    day = Number(dayMonthName[1]);
  } else if (monthNameDay) {
    year = Number(monthNameDay[3]);
    month = monthNames[monthNameDay[1]] ?? 0;
    day = Number(monthNameDay[2]);
  } else {
    return null;
  }
  const dateKey = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!dateKey) return null;
  const date = new Date(`${dateKey}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey
    ? null
    : dateKey;
}

function parseBoolean(value: string): boolean {
  return isTrueBooleanMarker(value);
}

const dateHeaders = new Set(['date', 'дата', 'measured_on', 'measuredon']);
const selfMeasuredHeaders = new Set([
  'self_measured',
  'самозамер',
  'самостоятельно',
  'is_self_measured',
]);
const rfmSexHeaders = new Set([
  'sex',
  'gender',
  'пол',
  'rfm_sex',
  'sex_for_rfm',
  'пол_для_rfm',
  'пол_для_расчета_rfm',
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
  body_fat: 'bodyFatPercent',
  body_fat_percent: 'bodyFatPercent',
  body_fat_percentage: 'bodyFatPercent',
  fat_percent: 'bodyFatPercent',
  жир: 'bodyFatPercent',
  процент_жира: 'bodyFatPercent',
  жир_percent: 'bodyFatPercent',
};

const monthNames: Record<string, number> = {
  january: 1,
  jan: 1,
  январь: 1,
  января: 1,
  february: 2,
  feb: 2,
  февраль: 2,
  февраля: 2,
  march: 3,
  mar: 3,
  март: 3,
  марта: 3,
  april: 4,
  apr: 4,
  апрель: 4,
  апреля: 4,
  may: 5,
  май: 5,
  мая: 5,
  june: 6,
  jun: 6,
  июнь: 6,
  июня: 6,
  july: 7,
  jul: 7,
  июль: 7,
  июля: 7,
  august: 8,
  aug: 8,
  август: 8,
  августа: 8,
  september: 9,
  sep: 9,
  сентябрь: 9,
  сентября: 9,
  october: 10,
  oct: 10,
  октябрь: 10,
  октября: 10,
  november: 11,
  nov: 11,
  ноябрь: 11,
  ноября: 11,
  december: 12,
  dec: 12,
  декабрь: 12,
  декабря: 12,
};

function matchMeasurementLabel(value: string): MeasurementLabelMatch | null {
  const normalized = normalizeHeader(value);
  const exact = measurementHeaderAliases[normalized];
  if (exact) return { keys: [exact], unitSystem: unitSystemFromText(value) };

  const tokens = normalized.split('_').filter(Boolean);
  const hasToken = (...prefixes: string[]) =>
    tokens.some((token) =>
      prefixes.some(
        (prefix) => token === prefix || (prefix.length > 1 && token.startsWith(prefix)),
      ),
    );
  let keys: MeasurementKey[] | null = null;
  if (hasToken('bodyfat', 'fat', 'жир')) keys = ['bodyFatPercent'];
  else if (hasToken('height', 'рост')) keys = ['heightCm'];
  else if (hasToken('weight', 'вес', 'масса')) keys = ['weightKg'];
  else if (hasToken('neck', 'шея', 'шеи')) keys = ['neckCm'];
  else if (hasToken('chest', 'грудь', 'груди')) keys = ['chestCm'];
  else if (hasToken('biceps', 'бицепс')) keys = ['bicepsCm'];
  else if (hasToken('thigh', 'бедро', 'бедра')) {
    if (hasToken('left', 'лев', 'л')) keys = ['thighLeftCm'];
    else if (hasToken('right', 'прав', 'п')) keys = ['thighRightCm'];
    else keys = ['thighLeftCm', 'thighRightCm'];
  } else if (hasToken('calf', 'икра', 'икры')) keys = ['calfCm'];
  else if (hasToken('waist', 'belly', 'талия', 'талии', 'живот')) keys = ['waistCm'];
  return keys ? { keys, unitSystem: unitSystemFromText(value) } : null;
}

function parseLocalizedNumber(value: string): number | null {
  const match = value.replace(/\u00a0/g, ' ').match(/[+-]?\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')) : null;
}

function parsePairedValues(value: string): Array<number | null> {
  const left = /(?:^|[\s;,/])(?:л|лев\p{L}*|left|l)\s*[:=–—-]?\s*(\d+(?:[.,]\d+)?)/iu.exec(value);
  const right = /(?:^|[\s;,/])(?:п|прав\p{L}*|right|r)\s*[:=–—-]?\s*(\d+(?:[.,]\d+)?)/iu.exec(
    value,
  );
  if (left || right) {
    return [
      left ? Number(left[1].replace(',', '.')) : null,
      right ? Number(right[1].replace(',', '.')) : null,
    ];
  }
  const numbers = [...value.matchAll(/\d+(?:[.,]\d+)?/g)].map((match) =>
    Number(match[0].replace(',', '.')),
  );
  return [numbers[0] ?? null, numbers[1] ?? null];
}

function hasMeasurementValue(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  return !['-', '—', '–', 'нет', 'n/a', 'na'].includes(value.trim().toLocaleLowerCase('ru-RU'));
}

function unitSystemFromText(value: string): UnitSystem | null {
  const normalized = ` ${value.toLocaleLowerCase('ru-RU').replace(/[.,;()[\]]/g, ' ')} `;
  if (/(?:\s|_)(?:lb|lbs|pound|pounds|in|inch|inches|дюйм\p{L}*)(?:\s|_|$)/u.test(normalized)) {
    return 'imperial';
  }
  if (/(?:\s|_)(?:kg|кг|cm|см)(?:\s|_|$)/u.test(normalized)) return 'metric';
  return null;
}

function isDateHeader(value: string): boolean {
  const normalized = normalizeHeader(value);
  return (
    dateHeaders.has(normalized) ||
    ['дата_замера', 'день_замера', 'measurement_date'].includes(normalized)
  );
}

function isRfmSexHeader(value: string): boolean {
  return rfmSexHeaders.has(normalizeHeader(value));
}

function parseRfmSex(value: string): RfmSex | null {
  const normalized = normalizeHeader(value);
  if (['male', 'man', 'm', 'м', 'муж', 'мужчина', 'мужской'].includes(normalized)) return 'male';
  if (['female', 'woman', 'f', 'ж', 'жен', 'женщина', 'женский'].includes(normalized)) {
    return 'female';
  }
  return null;
}

function isDateAxisLabel(value: string): boolean {
  const normalized = normalizeHeader(value);
  return (
    isDateHeader(value) ||
    normalized.includes('замер') ||
    normalized.includes('measurement') ||
    normalized.includes('dates')
  );
}

function isSelfMeasuredHeader(value: string): boolean {
  const normalized = normalizeHeader(value);
  return selfMeasuredHeaders.has(normalized) || normalized.includes('самозамер');
}

function isTrueBooleanMarker(value: string): boolean {
  return ['1', 'true', 'yes', 'да', 'самозамер', '+'].includes(
    value.trim().toLocaleLowerCase('ru-RU'),
  );
}

function isBooleanMarker(value: string): boolean {
  return ['0', '1', 'false', 'true', 'no', 'yes', 'нет', 'да', 'самозамер', '-', '+'].includes(
    value.trim().toLocaleLowerCase('ru-RU'),
  );
}
