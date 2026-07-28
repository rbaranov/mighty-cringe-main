import { useEffect, useMemo, useState } from 'react';

import type { MeasurementValues } from '@mighty-cringe/contracts';

import type { LocalMeasurement } from '../lib/db';
import {
  measurementDefinitions,
  measurementDelta,
  measurementTrend,
  orderedMeasurements,
  parseMeasurementCsv,
  previousMeasurement,
  resolvedMeasurementValue,
  type MeasurementDefinition,
  type ResolvedMeasurementValue,
} from '../lib/measurements';
import { dateKeyInTimeZone } from '../lib/progress';
import {
  canonicalMeasurementNumber,
  displayMeasurement,
  displayMeasurementNumber,
  measurementUnit,
  tr,
  usePreferences,
} from '../lib/preferences';

export type MeasurementDraft = {
  measuredOn: string;
  isSelfMeasured: boolean;
  values: MeasurementValues;
};

export function BodyMeasurementsSection({
  measurements,
  onSave,
  onImport,
  onDelete,
}: {
  measurements: LocalMeasurement[];
  onSave: (draft: MeasurementDraft, existing: LocalMeasurement | null) => Promise<void>;
  onImport: (drafts: MeasurementDraft[]) => Promise<void>;
  onDelete: (measurement: LocalMeasurement) => void;
}) {
  const { locale, unitSystem } = usePreferences();
  const ordered = useMemo(() => orderedMeasurements(measurements), [measurements]);
  const latest = ordered.at(-1) ?? null;
  const [showHistory, setShowHistory] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<LocalMeasurement | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const selected = ordered.find((measurement) => measurement.id === selectedId) ?? latest;
  const previous = selected ? previousMeasurement(ordered, selected.id) : null;
  const featured = measurementDefinitions.filter(
    (definition) =>
      definition.featured &&
      (definition.key === 'bodyFatPercent' || measurementTrend(ordered, definition.key).length > 0),
  );

  return (
    <section className="progress-section body-progress" aria-labelledby="body-heading">
      <div className="section-head progress-heading">
        <div>
          <p className="eyebrow">{tr(locale, 'Тело', 'Body')}</p>
          <h2 id="body-heading">{tr(locale, 'Замеры и вес', 'Measurements and weight')}</h2>
        </div>
        <div className="body-actions">
          <button className="button ghost small" onClick={() => setImporting(true)} type="button">
            {tr(locale, 'Импорт таблицы', 'Import table')}
          </button>
          <button className="button primary small" onClick={() => setEditing('new')} type="button">
            + {tr(locale, 'Замер', 'Measurement')}
          </button>
        </div>
      </div>

      {ordered.length ? (
        <>
          <div className="measurement-trends">
            {featured.map((definition) => (
              <MeasurementTrendCard
                definition={definition}
                key={definition.key}
                measurements={ordered}
              />
            ))}
          </div>

          <button
            className="measurement-history-toggle"
            onClick={() => setShowHistory((visible) => !visible)}
            type="button"
          >
            <span>{tr(locale, 'Вся история замеров', 'Full measurement history')}</span>
            <strong>{ordered.length}</strong>
            <i>{showHistory ? tr(locale, 'Скрыть', 'Hide') : tr(locale, 'Открыть', 'Open')} →</i>
          </button>

          {showHistory && (
            <div className="measurement-history">
              {[...ordered].reverse().map((measurement) => (
                <button
                  className={measurement.id === selected?.id ? 'selected' : ''}
                  key={measurement.id}
                  onClick={() => setSelectedId(measurement.id)}
                  type="button"
                >
                  <time dateTime={measurement.measuredOn}>
                    {formatMeasurementDate(measurement, locale)}
                  </time>
                  <span>{measurementSummary(measurement, locale, unitSystem)}</span>
                  <SyncBadge measurement={measurement} />
                </button>
              ))}
            </div>
          )}

          {selected && (
            <MeasurementDetail
              measurement={selected}
              onDelete={() => onDelete(selected)}
              onEdit={() => setEditing(selected)}
              previous={previous}
              measurements={ordered}
            />
          )}
        </>
      ) : (
        <div className="progress-empty measurement-empty">
          <strong>{tr(locale, 'Начни с любой даты', 'Start with any date')}</strong>
          <span>
            {tr(
              locale,
              'Можно внести сегодняшний замер или импортировать старую запись — история выстроится автоматически.',
              'Add today’s measurement or import an older entry — the history will be ordered automatically.',
            )}
          </span>
          <button className="button primary small" onClick={() => setEditing('new')} type="button">
            {tr(locale, 'Добавить первый замер', 'Add first measurement')}
          </button>
        </div>
      )}

      {editing && (
        <MeasurementSheet
          existing={ordered}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (draft, existing) => {
            await onSave(draft, existing);
            setSelectedId(existing?.id ?? null);
            setEditing(null);
          }}
        />
      )}
      {importing && (
        <MeasurementImportSheet
          existing={ordered}
          onClose={() => setImporting(false)}
          onImport={async (drafts) => {
            await onImport(drafts);
            setImporting(false);
          }}
        />
      )}
    </section>
  );
}

function MeasurementImportSheet({
  existing,
  onClose,
  onImport,
}: {
  existing: LocalMeasurement[];
  onClose: () => void;
  onImport: (drafts: MeasurementDraft[]) => Promise<void>;
}) {
  const { locale, unitSystem } = usePreferences();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [saving, setSaving] = useState(false);
  const parsed = useMemo(
    () => parseMeasurementCsv(text, { locale, unitSystem }),
    [locale, text, unitSystem],
  );
  const existingDates = new Set(
    existing.map((measurement) => dateKeyInTimeZone(measurement.measuredOn, timeZone)),
  );
  const duplicateErrors = parsed.rows
    .filter((row) => existingDates.has(row.dateKey))
    .map((row) =>
      tr(
        locale,
        `Строка ${row.line}: за ${row.dateKey} уже есть запись.`,
        `Row ${row.line}: an entry already exists for ${row.dateKey}.`,
      ),
    );
  const errors = fileError ? [fileError] : [...parsed.errors, ...duplicateErrors];

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        aria-labelledby="measurement-import-title"
        aria-modal="true"
        className="sheet measurement-import-sheet"
        role="dialog"
      >
        <div className="sheet-handle" />
        <p className="eyebrow">{tr(locale, 'История тела', 'Body history')}</p>
        <h2 id="measurement-import-title">{tr(locale, 'Импорт таблицы', 'Import table')}</h2>
        <p className="intro">
          {tr(
            locale,
            'Выбери CSV, TSV или TXT либо вставь таблицу целиком. Даты могут идти вниз или по горизонтали — подписи, пояснения и единицы распознаются автоматически.',
            'Choose a CSV, TSV, or TXT file, or paste the whole table. Dates may run down or across; labels, notes, and units are detected automatically.',
          )}
        </p>
        <label className="measurement-import-picker">
          <span>{tr(locale, 'Выбрать файл', 'Choose file')}</span>
          <input
            accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
            aria-label={tr(locale, 'Выбрать файл с замерами', 'Choose measurement file')}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              setFileError('');
              if (file.size > 2_000_000) {
                setText('');
                setFileError(
                  tr(
                    locale,
                    'Файл больше 2 МБ. Сохрани только лист с замерами в CSV, TSV или TXT.',
                    'The file is larger than 2 MB. Save only the measurement sheet as CSV, TSV, or TXT.',
                  ),
                );
                return;
              }
              try {
                setText(await file.text());
              } catch {
                setText('');
                setFileError(
                  tr(
                    locale,
                    'Не удалось прочитать файл. Сохрани его как CSV, TSV или TXT.',
                    'Could not read the file. Save it as CSV, TSV, or TXT.',
                  ),
                );
              }
            }}
            onClick={(event) => {
              event.currentTarget.value = '';
            }}
            type="file"
          />
        </label>
        {fileName && <small className="measurement-import-file-name">{fileName}</small>}
        <div className="measurement-import-divider">
          <span>{tr(locale, 'или вставить', 'or paste')}</span>
        </div>
        <textarea
          aria-label={tr(locale, 'Таблица с историей замеров', 'Measurement history table')}
          onChange={(event) => {
            setText(event.target.value);
            setFileName('');
            setFileError('');
          }}
          placeholder={
            locale === 'en'
              ? 'Date;Weight;Chest;Waist\n2025-03-23;82.5;103;91\n\n—or—\nMeasurements,2025-03-23\nWeight,82.5\nWaist,91'
              : 'Дата;Вес;Грудь;Талия\n23.03.2025;82,5;103;91\n\n— или —\nЗамеры,23.03.2025\nВес,"82,5"\nЖивот,91'
          }
          rows={7}
          value={text}
        />
        {(text || fileError) && (
          <div className={errors.length ? 'import-result error' : 'import-result'}>
            <strong>
              {errors.length
                ? tr(locale, `Нужно исправить: ${errors.length}`, `Issues to fix: ${errors.length}`)
                : tr(
                    locale,
                    `Готово к импорту: ${parsed.rows.length}`,
                    `Ready to import: ${parsed.rows.length}`,
                  )}
            </strong>
            {errors.slice(0, 5).map((error, index) => (
              <span key={`${index}-${error}`}>{error}</span>
            ))}
          </div>
        )}
        {!errors.length && parsed.rows.length > 0 && (
          <div className="measurement-import-preview">
            {parsed.rows.slice(0, 5).map((row) => (
              <div key={row.dateKey}>
                <strong>{formatImportDate(row.dateKey, locale)}</strong>
                <span>{formatImportSummary(row.values, locale, unitSystem)}</span>
              </div>
            ))}
            {parsed.rows.length > 5 && (
              <small>
                {tr(
                  locale,
                  `И ещё дат: ${parsed.rows.length - 5}`,
                  `And ${parsed.rows.length - 5} more dates`,
                )}
              </small>
            )}
          </div>
        )}
        <div className="sheet-actions">
          <button className="button ghost" disabled={saving} onClick={onClose} type="button">
            {tr(locale, 'Отмена', 'Cancel')}
          </button>
          <button
            className="button primary"
            disabled={!parsed.rows.length || errors.length > 0 || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onImport(
                  parsed.rows.map((row) => ({
                    measuredOn: new Date(`${row.dateKey}T12:00:00`).toISOString(),
                    isSelfMeasured: row.isSelfMeasured,
                    values: row.values,
                  })),
                );
              } finally {
                setSaving(false);
              }
            }}
            type="button"
          >
            {saving
              ? tr(locale, 'Импортирую…', 'Importing…')
              : tr(
                  locale,
                  `Импортировать ${parsed.rows.length || ''}`,
                  `Import ${parsed.rows.length || ''}`,
                )}
          </button>
        </div>
      </section>
    </div>
  );
}

function formatImportDate(dateKey: string, locale: 'ru' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

function formatImportSummary(
  values: MeasurementValues,
  locale: 'ru' | 'en',
  unitSystem: 'metric' | 'imperial',
): string {
  const recorded = measurementDefinitions.filter(({ key }) => values[key] !== null);
  const visible = recorded.slice(0, 4).map((definition) => {
    const value = values[definition.key]!;
    return `${measurementCopy(definition, locale).shortLabel}: ${displayMeasurement(
      definition.key,
      value,
      locale,
      unitSystem,
    )}`;
  });
  if (recorded.length > visible.length) {
    visible.push(
      tr(
        locale,
        `ещё ${recorded.length - visible.length}`,
        `+${recorded.length - visible.length} more`,
      ),
    );
  }
  return visible.join(' · ');
}

function MeasurementTrendCard({
  definition,
  measurements,
}: {
  definition: MeasurementDefinition;
  measurements: LocalMeasurement[];
}) {
  const { locale, unitSystem } = usePreferences();
  const trend = measurementTrend(measurements, definition.key);
  const latestPoint = trend.at(-1) ?? null;
  const latestMeasurement =
    measurements.find((measurement) => measurement.id === latestPoint?.measurementId) ??
    measurements.at(-1)!;
  const resolved = resolvedMeasurementValue(latestMeasurement, definition.key, measurements);
  const previous = latestPoint ? previousMeasurement(measurements, latestMeasurement.id) : null;
  const delta = latestPoint
    ? measurementDelta(latestMeasurement, previous, definition.key, measurements)
    : null;
  const bodyFat = definition.key === 'bodyFatPercent';

  return (
    <article className={bodyFat ? 'body-fat-trend' : undefined}>
      <div>
        <span>{measurementCopy(definition, locale).shortLabel}</span>
        <strong>
          {resolved.value === null
            ? '—'
            : displayMeasurement(definition.key, resolved.value, locale, unitSystem)}
        </strong>
        <small>
          {bodyFat
            ? bodyFatSourceLabel(resolved, locale)
            : formatDelta(delta, definition.key, locale, unitSystem)}
        </small>
        {bodyFat && resolved.value !== null && (
          <small>{formatDelta(delta, definition.key, locale, unitSystem)}</small>
        )}
      </div>
      {trend.length > 0 ? (
        <Sparkline
          label={measurementCopy(definition, locale).label}
          values={trend.map((point) => point.value)}
        />
      ) : (
        <span className="measurement-trend-missing" aria-hidden="true">
          %
        </span>
      )}
    </article>
  );
}

function Sparkline({ values, label }: { values: number[]; label: string }) {
  const { locale } = usePreferences();
  const visibleValues = values.slice(-12);
  const minimum = Math.min(...visibleValues);
  const maximum = Math.max(...visibleValues);
  const spread = Math.max(maximum - minimum, 1);
  const points = visibleValues
    .map((value, index, visible) => {
      const x = visible.length === 1 ? 60 : 4 + (index / (visible.length - 1)) * 112;
      const y = 38 - ((value - minimum) / spread) * 30;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg aria-label={`${tr(locale, 'Тренд', 'Trend')}: ${label}`} role="img" viewBox="0 0 120 44">
      <polyline points={points} />
      {visibleValues.length === 1 && <circle cx="60" cy="38" r="3" />}
    </svg>
  );
}

function MeasurementDetail({
  measurement,
  measurements,
  previous,
  onEdit,
  onDelete,
}: {
  measurement: LocalMeasurement;
  measurements: LocalMeasurement[];
  previous: LocalMeasurement | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { locale, unitSystem } = usePreferences();
  const recorded = measurementDefinitions.filter(
    (definition) =>
      definition.key === 'bodyFatPercent' ||
      resolvedMeasurementValue(measurement, definition.key, measurements).value !== null,
  );
  return (
    <article className="measurement-detail">
      <header>
        <div>
          <span>{tr(locale, 'Запись от', 'Entry from')}</span>
          <strong>{formatMeasurementDate(measurement, locale)}</strong>
        </div>
        <div className="measurement-actions">
          <button onClick={onEdit} type="button">
            {tr(locale, 'Изменить', 'Edit')}
          </button>
          <button className="danger-text" onClick={onDelete} type="button">
            {tr(locale, 'Удалить', 'Delete')}
          </button>
        </div>
      </header>
      {measurement.isSelfMeasured && (
        <p className="self-measured">{tr(locale, 'Самозамер', 'Self measured')}</p>
      )}
      <div className="measurement-values">
        {recorded.map((definition) => {
          const resolved = resolvedMeasurementValue(measurement, definition.key, measurements);
          const delta = measurementDelta(measurement, previous, definition.key, measurements);
          const bodyFat = definition.key === 'bodyFatPercent';
          return (
            <div key={definition.key}>
              <span>{measurementCopy(definition, locale).label}</span>
              <strong>
                {resolved.value === null
                  ? '—'
                  : displayMeasurement(definition.key, resolved.value, locale, unitSystem)}
              </strong>
              {bodyFat && <small>{bodyFatSourceLabel(resolved, locale)}</small>}
              {(!bodyFat || resolved.value !== null) && (
                <small>{formatDelta(delta, definition.key, locale, unitSystem)}</small>
              )}
            </div>
          );
        })}
      </div>
      <p className="measurement-delta-note">
        {previous
          ? tr(
              locale,
              `Изменения показаны относительно ${formatMeasurementDate(previous, locale)}.`,
              `Changes are shown relative to ${formatMeasurementDate(previous, locale)}.`,
            )
          : tr(
              locale,
              'Это первая запись — сравнение появится после следующего замера.',
              'This is the first entry — a comparison will appear after the next measurement.',
            )}
      </p>
    </article>
  );
}

function MeasurementSheet({
  existing,
  initial,
  onClose,
  onSave,
}: {
  existing: LocalMeasurement[];
  initial: LocalMeasurement | null;
  onClose: () => void;
  onSave: (draft: MeasurementDraft, existing: LocalMeasurement | null) => Promise<void>;
}) {
  const { locale, unitSystem } = usePreferences();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const today = dateKeyInTimeZone(new Date(), timeZone);
  const [dateKey, setDateKey] = useState(today);
  const [isSelfMeasured, setIsSelfMeasured] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDateKey(initial ? dateKeyInTimeZone(initial.measuredOn, timeZone) : today);
    setIsSelfMeasured(initial?.isSelfMeasured ?? true);
    setValues(
      Object.fromEntries(
        measurementDefinitions.map((definition) => {
          const value = initial?.values[definition.key];
          return [
            definition.key,
            value === null || value === undefined
              ? ''
              : String(displayMeasurementNumber(definition.key, value, unitSystem)),
          ];
        }),
      ),
    );
  }, [initial, timeZone, today, unitSystem]);

  const parsedValues = parseValues(values, unitSystem);
  const invalid = parsedValues === null;
  const duplicateDate = existing.some(
    (measurement) =>
      measurement.id !== initial?.id &&
      dateKeyInTimeZone(measurement.measuredOn, timeZone) === dateKey,
  );

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        aria-labelledby="measurement-sheet-title"
        aria-modal="true"
        className="sheet measurement-sheet"
        role="dialog"
      >
        <div className="sheet-handle" />
        <p className="eyebrow">{tr(locale, 'История тела', 'Body history')}</p>
        <h2 id="measurement-sheet-title">
          {initial
            ? tr(locale, 'Изменить замер', 'Edit measurement')
            : tr(locale, 'Новый замер', 'New measurement')}
        </h2>
        <p className="intro">
          {tr(
            locale,
            'Выбери любую прошлую дату для импорта. Пустые поля не сохраняются.',
            'Choose any past date when importing. Empty fields are not saved.',
          )}
        </p>
        <label className="measurement-date">
          {tr(locale, 'Дата', 'Date')}
          <input
            max={today}
            onChange={(event) => setDateKey(event.target.value)}
            type="date"
            value={dateKey}
          />
        </label>
        <label className="self-measured-toggle">
          <input
            checked={isSelfMeasured}
            onChange={(event) => setIsSelfMeasured(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>{tr(locale, 'Самозамер', 'Self measured')}</strong>
            <small>
              {tr(locale, 'Измерение сделано самостоятельно', 'Measurement taken by yourself')}
            </small>
          </span>
        </label>
        <div className="measurement-form-grid">
          {measurementDefinitions.map((definition) => (
            <label key={definition.key} title={measurementCopy(definition, locale).help}>
              <span>{measurementCopy(definition, locale).label}</span>
              <div>
                <input
                  inputMode="decimal"
                  max={displayMeasurementNumber(definition.key, definition.maximum, unitSystem)}
                  min="0.1"
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [definition.key]: event.target.value }))
                  }
                  placeholder="—"
                  step="0.1"
                  type="number"
                  value={values[definition.key] ?? ''}
                />
                <small>{measurementUnit(definition.key, unitSystem, locale)}</small>
              </div>
              <em>{measurementCopy(definition, locale).help}</em>
            </label>
          ))}
        </div>
        {invalid && (
          <p className="measurement-error">
            {tr(
              locale,
              'Заполни хотя бы одно поле положительным числом.',
              'Enter a positive number in at least one field.',
            )}
          </p>
        )}
        {duplicateDate && (
          <p className="measurement-error">
            {tr(
              locale,
              'За эту дату уже есть замер — измени существующую запись.',
              'A measurement already exists for this date — edit that entry.',
            )}
          </p>
        )}
        <div className="sheet-actions">
          <button className="button ghost" disabled={saving} onClick={onClose} type="button">
            {tr(locale, 'Отмена', 'Cancel')}
          </button>
          <button
            className="button primary"
            disabled={invalid || duplicateDate || !dateKey || saving}
            onClick={async () => {
              if (!parsedValues) return;
              setSaving(true);
              try {
                await onSave(
                  {
                    measuredOn: new Date(`${dateKey}T12:00:00`).toISOString(),
                    isSelfMeasured,
                    values: parsedValues,
                  },
                  initial,
                );
              } finally {
                setSaving(false);
              }
            }}
            type="button"
          >
            {saving ? tr(locale, 'Сохраняю…', 'Saving…') : tr(locale, 'Сохранить', 'Save')}
          </button>
        </div>
      </section>
    </div>
  );
}

function SyncBadge({ measurement }: { measurement: LocalMeasurement }) {
  const { locale } = usePreferences();
  if (measurement.syncState === 'synced') return null;
  return (
    <em>
      {measurement.syncState === 'conflict'
        ? tr(locale, 'нужен выбор', 'needs review')
        : tr(locale, 'синхронизация', 'syncing')}
    </em>
  );
}

function parseValues(
  values: Record<string, string>,
  unitSystem: 'metric' | 'imperial',
): MeasurementValues | null {
  const parsed = Object.fromEntries(
    measurementDefinitions.map((definition) => {
      const raw = values[definition.key]?.trim().replace(',', '.') ?? '';
      return [
        definition.key,
        raw === '' ? null : canonicalMeasurementNumber(definition.key, Number(raw), unitSystem),
      ];
    }),
  ) as MeasurementValues;
  const recorded = Object.values(parsed).filter((value): value is number => value !== null);
  const valid = measurementDefinitions.every((definition) => {
    const value = parsed[definition.key];
    return value === null || (Number.isFinite(value) && value > 0 && value <= definition.maximum);
  });
  return recorded.length && valid ? parsed : null;
}

function measurementSummary(
  measurement: LocalMeasurement,
  locale: 'ru' | 'en',
  unitSystem: 'metric' | 'imperial',
): string {
  const parts = measurementDefinitions
    .filter((definition) => definition.featured && measurement.values[definition.key] !== null)
    .slice(0, 2)
    .map(
      (definition) =>
        `${measurementCopy(definition, locale).shortLabel}: ${displayMeasurement(definition.key, measurement.values[definition.key]!, locale, unitSystem)}`,
    );
  return parts.join(' · ') || tr(locale, 'Запись замеров', 'Measurement entry');
}

function measurementCopy(definition: MeasurementDefinition, locale: 'ru' | 'en') {
  if (locale === 'ru') {
    return {
      label: definition.label,
      shortLabel: definition.shortLabel,
      help: definition.help,
    };
  }
  return englishMeasurementCopy[definition.key];
}

const englishMeasurementCopy: Record<
  keyof MeasurementValues,
  { label: string; shortLabel: string; help: string }
> = {
  heightCm: { label: 'Height', shortLabel: 'Height', help: 'Stand straight without shoes.' },
  weightKg: {
    label: 'Weight',
    shortLabel: 'Weight',
    help: 'Body weight measured under consistent conditions.',
  },
  neckCm: {
    label: 'Neck',
    shortLabel: 'Neck',
    help: 'The narrowest point below the Adam’s apple.',
  },
  chestCm: {
    label: 'Chest',
    shortLabel: 'Chest',
    help: 'At armpit level with arms relaxed.',
  },
  bicepsCm: {
    label: 'Biceps',
    shortLabel: 'Biceps',
    help: 'Elbow bent to 90°, muscle relaxed.',
  },
  thighLeftCm: {
    label: 'Left thigh',
    shortLabel: 'Left thigh',
    help: 'Standing relaxed, tape around mid-thigh.',
  },
  thighRightCm: {
    label: 'Right thigh',
    shortLabel: 'Right thigh',
    help: 'Standing relaxed, tape around mid-thigh.',
  },
  calfCm: { label: 'Calf', shortLabel: 'Calf', help: 'Standing, at the widest point.' },
  waistCm: {
    label: 'Abdomen / waist',
    shortLabel: 'Waist',
    help: 'The widest point below the navel.',
  },
  bodyFatPercent: {
    label: 'Body fat',
    shortLabel: 'Body fat',
    help: 'Enter it directly, or leave blank for an approximate male RFM estimate from height and waist.',
  },
};

function formatMeasurementDate(measurement: LocalMeasurement, locale: 'ru' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(measurement.measuredOn));
}

function formatDelta(
  value: number | null,
  key: keyof MeasurementValues,
  locale: 'ru' | 'en',
  unitSystem: 'metric' | 'imperial',
): string {
  if (value === null) return tr(locale, 'нет сравнения', 'no comparison');
  if (Math.abs(value) < 0.05) return tr(locale, 'без изменений', 'no change');
  const displayed = displayMeasurementNumber(key, Math.abs(value), unitSystem);
  const formatted = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    maximumFractionDigits: 1,
  }).format(displayed);
  return `${value > 0 ? '+' : '−'}${formatted} ${measurementUnit(key, unitSystem, locale)}`;
}

function bodyFatSourceLabel(resolved: ResolvedMeasurementValue, locale: 'ru' | 'en'): string {
  if (resolved.source === 'recorded') {
    return tr(locale, 'введено вручную', 'entered manually');
  }
  if (resolved.source === 'rfm-estimate') {
    return tr(locale, 'примерная оценка RFM', 'approximate RFM estimate');
  }
  return tr(
    locale,
    'добавь рост и талию или введи вручную',
    'add height and waist, or enter manually',
  );
}
