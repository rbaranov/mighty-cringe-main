import { useEffect, useMemo, useState } from 'react';

import type { BodyFatMeasurement, MeasurementValues } from '@mighty-cringe/contracts';

import type { LocalMeasurement } from '../lib/db';
import {
  bodyFatDelta,
  bodyFatTrend,
  calculateRelativeFatMass,
  measurementDefinitions,
  measurementDelta,
  measurementTrend,
  orderedMeasurements,
  parseMeasurementCsv,
  previousMeasurement,
  type MeasurementDefinition,
} from '../lib/measurements';
import { dateKeyInTimeZone } from '../lib/progress';
import {
  canonicalMeasurementNumber,
  displayMeasurement,
  displayMeasurementNumber,
  measurementUnit,
  tr,
  usePreferences,
  type PhysicalMeasurementKey,
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
    (definition) => definition.featured && measurementTrend(ordered, definition.key).length,
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
            {bodyFatTrend(ordered).length > 0 && <BodyFatTrendCard measurements={ordered} />}
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
  const visible = recorded.slice(0, values.bodyFat ? 3 : 4).map((definition) => {
    const value = values[definition.key]!;
    return `${measurementCopy(definition, locale).shortLabel}: ${displayMeasurement(
      definition.key,
      value,
      locale,
      unitSystem,
    )}`;
  });
  if (values.bodyFat) {
    visible.unshift(
      `${tr(locale, 'Жир', 'Body fat')}: ${formatBodyFatPercent(values.bodyFat.percent, locale)}`,
    );
  }
  const recordedCount = recorded.length + (values.bodyFat ? 1 : 0);
  if (recordedCount > visible.length) {
    visible.push(
      tr(
        locale,
        `ещё ${recordedCount - visible.length}`,
        `+${recordedCount - visible.length} more`,
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
  const latestPoint = trend.at(-1)!;
  const latestMeasurement = measurements.find(
    (measurement) => measurement.id === latestPoint.measurementId,
  )!;
  const previous = previousMeasurement(measurements, latestMeasurement.id);
  const latestValue = latestMeasurement.values[definition.key];
  const delta = measurementDelta(latestMeasurement, previous, definition.key);

  return (
    <article>
      <div>
        <span>{measurementCopy(definition, locale).shortLabel}</span>
        <strong>
          {latestValue === null
            ? '—'
            : displayMeasurement(definition.key, latestValue, locale, unitSystem)}
        </strong>
        <small>{formatDelta(delta, definition.key, locale, unitSystem)}</small>
      </div>
      <Sparkline
        label={measurementCopy(definition, locale).label}
        values={trend.map((point) => point.value)}
      />
    </article>
  );
}

function BodyFatTrendCard({ measurements }: { measurements: LocalMeasurement[] }) {
  const { locale } = usePreferences();
  const trend = bodyFatTrend(measurements);
  const latestPoint = trend.at(-1)!;
  const latestMeasurement = measurements.find(
    (measurement) => measurement.id === latestPoint.measurementId,
  )!;
  const previous = previousMeasurement(measurements, latestMeasurement.id);
  const bodyFat = latestMeasurement.values.bodyFat!;
  return (
    <article className="body-fat-trend-card">
      <div>
        <span>{tr(locale, '% жира', 'Body fat')}</span>
        <strong>{formatBodyFatPercent(bodyFat.percent, locale)}</strong>
        <small>{formatBodyFatDelta(bodyFatDelta(latestMeasurement, previous), locale)}</small>
        <BodyFatSourceBadge bodyFat={bodyFat} />
      </div>
      <Sparkline
        label={tr(locale, 'Процент жира', 'Body fat percentage')}
        values={trend.map((point) => point.value)}
      />
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
  previous,
  onEdit,
  onDelete,
}: {
  measurement: LocalMeasurement;
  previous: LocalMeasurement | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { locale, unitSystem } = usePreferences();
  const recorded = measurementDefinitions.filter(
    (definition) => measurement.values[definition.key] !== null,
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
        {measurement.values.bodyFat && (
          <div className="body-fat-value">
            <span>{tr(locale, '% жира', 'Body fat')}</span>
            <strong>{formatBodyFatPercent(measurement.values.bodyFat.percent, locale)}</strong>
            <small>{formatBodyFatDelta(bodyFatDelta(measurement, previous), locale)}</small>
            <BodyFatSourceBadge bodyFat={measurement.values.bodyFat} />
          </div>
        )}
        {recorded.map((definition) => {
          const value = measurement.values[definition.key]!;
          const delta = measurementDelta(measurement, previous, definition.key);
          return (
            <div key={definition.key}>
              <span>{measurementCopy(definition, locale).label}</span>
              <strong>{displayMeasurement(definition.key, value, locale, unitSystem)}</strong>
              <small>{formatDelta(delta, definition.key, locale, unitSystem)}</small>
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
  const historicalBodyFat = useMemo(
    () =>
      [...orderedMeasurements(existing)].reverse().find((measurement) => measurement.values.bodyFat)
        ?.values.bodyFat ?? null,
    [existing],
  );
  const [dateKey, setDateKey] = useState(today);
  const [isSelfMeasured, setIsSelfMeasured] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});
  const [bodyFatMode, setBodyFatMode] = useState<'none' | 'calculated' | 'manual'>('none');
  const [bodyFatSex, setBodyFatSex] = useState<'' | 'male' | 'female'>('');
  const [manualBodyFat, setManualBodyFat] = useState('');
  const [saving, setSaving] = useState(false);
  const historicalHeightCm = useMemo(
    () =>
      [...orderedMeasurements(existing)]
        .reverse()
        .find(
          (measurement) =>
            measurement.values.heightCm !== null &&
            dateKeyInTimeZone(measurement.measuredOn, timeZone) <= dateKey,
        )?.values.heightCm ?? null,
    [dateKey, existing, timeZone],
  );

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
    const initialBodyFat = initial?.values.bodyFat;
    setBodyFatMode(
      initialBodyFat?.source === 'manual'
        ? 'manual'
        : initialBodyFat?.source === 'calculated'
          ? 'calculated'
          : 'none',
    );
    setBodyFatSex(
      initialBodyFat?.source === 'calculated'
        ? initialBodyFat.sex
        : historicalBodyFat?.source === 'calculated'
          ? historicalBodyFat.sex
          : '',
    );
    setManualBodyFat(
      initialBodyFat?.source === 'manual' ? formatBodyFatInput(initialBodyFat.percent, locale) : '',
    );
  }, [historicalBodyFat, initial, locale, timeZone, today, unitSystem]);

  const parsedMeasurements = parseMeasurementInputs(values, unitSystem);
  const currentHeightCm = parsedMeasurements?.heightCm ?? null;
  const calculationHeightCm = currentHeightCm ?? historicalHeightCm;
  const currentWaistCm = parsedMeasurements?.waistCm ?? null;
  const calculatedBodyFat =
    bodyFatSex && calculationHeightCm !== null && currentWaistCm !== null
      ? calculateRelativeFatMass(calculationHeightCm, currentWaistCm, bodyFatSex)
      : null;
  const manualBodyFatPercent = parseBodyFatInput(manualBodyFat);
  const selectedBodyFat: BodyFatMeasurement | null =
    bodyFatMode === 'manual' && manualBodyFatPercent !== null
      ? { percent: manualBodyFatPercent, source: 'manual' }
      : bodyFatMode === 'calculated'
        ? calculatedBodyFat
        : null;
  const bodyFatInvalid =
    (bodyFatMode === 'manual' && manualBodyFatPercent === null) ||
    (bodyFatMode === 'calculated' && calculatedBodyFat === null);
  const parsedValues =
    parsedMeasurements && !bodyFatInvalid ? withBodyFat(parsedMeasurements, selectedBodyFat) : null;
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
        <section className="body-fat-entry" aria-labelledby="body-fat-entry-title">
          <div className="body-fat-entry-head">
            <div>
              <span className="eyebrow">{tr(locale, 'Состав тела', 'Body composition')}</span>
              <h3 id="body-fat-entry-title">{tr(locale, '% жира', 'Body fat %')}</h3>
            </div>
            <span>{tr(locale, 'оценка', 'estimate')}</span>
          </div>
          <div
            className="body-fat-mode"
            role="group"
            aria-label={tr(locale, 'Источник процента жира', 'Body fat source')}
          >
            {(
              [
                ['calculated', tr(locale, 'Рассчитать', 'Calculate')],
                ['manual', tr(locale, 'Ввести вручную', 'Enter manually')],
                ['none', tr(locale, 'Не указывать', 'Skip')],
              ] as const
            ).map(([mode, label]) => (
              <button
                aria-pressed={bodyFatMode === mode}
                className={bodyFatMode === mode ? 'selected' : ''}
                key={mode}
                onClick={() => setBodyFatMode(mode)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          {bodyFatMode === 'calculated' && (
            <div className="body-fat-calculation">
              <p>
                {tr(
                  locale,
                  'Формула RFM использует рост и текущую талию. Выбери вариант формулы:',
                  'The RFM formula uses height and the current waist. Choose the formula variant:',
                )}
              </p>
              <div
                className="body-fat-sex"
                role="group"
                aria-label={tr(locale, 'Вариант формулы RFM', 'RFM formula variant')}
              >
                <button
                  aria-pressed={bodyFatSex === 'male'}
                  className={bodyFatSex === 'male' ? 'selected' : ''}
                  onClick={() => setBodyFatSex('male')}
                  type="button"
                >
                  {tr(locale, 'Мужская', 'Male')}
                </button>
                <button
                  aria-pressed={bodyFatSex === 'female'}
                  className={bodyFatSex === 'female' ? 'selected' : ''}
                  onClick={() => setBodyFatSex('female')}
                  type="button"
                >
                  {tr(locale, 'Женская', 'Female')}
                </button>
              </div>
              {calculatedBodyFat ? (
                <div className="body-fat-preview" role="status">
                  <strong>{formatBodyFatPercent(calculatedBodyFat.percent, locale)}</strong>
                  <span>
                    {tr(locale, 'Рассчитано · RFM', 'Calculated · RFM')}
                    {currentHeightCm === null && historicalHeightCm !== null
                      ? tr(
                          locale,
                          ' · рост из последнего замера',
                          ' · height from the latest measurement',
                        )
                      : ''}
                  </span>
                </div>
              ) : (
                <p className="body-fat-requirements">
                  {tr(
                    locale,
                    'Нужны вариант формулы, рост и талия в текущем замере. Рост можно взять из последней записи.',
                    'Formula variant, height, and a current waist are required. Height may come from the latest entry.',
                  )}
                </p>
              )}
              <small>
                {tr(
                  locale,
                  'Это приблизительная оценка состава тела для взрослых, а не медицинское измерение.',
                  'This is an approximate adult body-composition estimate, not a medical measurement.',
                )}
              </small>
            </div>
          )}
          {bodyFatMode === 'manual' && (
            <label className="body-fat-manual">
              <span>{tr(locale, 'Процент жира', 'Body fat percentage')}</span>
              <div>
                <input
                  inputMode="decimal"
                  max="75"
                  min="0.1"
                  onChange={(event) => setManualBodyFat(event.target.value)}
                  placeholder="—"
                  pattern="[0-9]*[.,]?[0-9]*"
                  step="0.1"
                  type="text"
                  value={manualBodyFat}
                />
                <small>%</small>
              </div>
              <em>
                {tr(
                  locale,
                  'Например, значение с биоимпедансных весов или калипера.',
                  'For example, a value from a bioimpedance scale or calipers.',
                )}
              </em>
            </label>
          )}
        </section>
        {invalid && (
          <p className="measurement-error">
            {bodyFatInvalid
              ? tr(
                  locale,
                  'Заверши выбранный способ определения процента жира или выбери «Не указывать».',
                  'Complete the selected body-fat method or choose “Skip”.',
                )
              : tr(
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

function BodyFatSourceBadge({ bodyFat }: { bodyFat: BodyFatMeasurement }) {
  const { locale } = usePreferences();
  const label =
    bodyFat.source === 'manual'
      ? tr(locale, 'Введено вручную', 'Entered manually')
      : tr(
          locale,
          `Рассчитано · RFM · ${bodyFat.sex === 'male' ? 'муж.' : 'жен.'}`,
          `Calculated · RFM · ${bodyFat.sex}`,
        );
  return (
    <em className={`body-fat-source ${bodyFat.source}`} title={label}>
      {label}
    </em>
  );
}

function formatBodyFatPercent(value: number, locale: 'ru' | 'en') {
  const formatted = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    maximumFractionDigits: 1,
  }).format(value);
  return `${formatted}%`;
}

function formatBodyFatInput(value: number, locale: 'ru' | 'en') {
  const formatted = String(value);
  return locale === 'ru' ? formatted.replace('.', ',') : formatted;
}

function formatBodyFatDelta(value: number | null, locale: 'ru' | 'en') {
  if (value === null) return tr(locale, 'нет сравнения', 'no comparison');
  if (Math.abs(value) < 0.05) return tr(locale, 'без изменений', 'no change');
  const formatted = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    maximumFractionDigits: 1,
  }).format(Math.abs(value));
  return `${value > 0 ? '+' : '−'}${formatted} ${tr(locale, 'п.п.', 'pp')}`;
}

function parseMeasurementInputs(
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
  const valid = measurementDefinitions.every((definition) => {
    const value = parsed[definition.key];
    return value === null || (Number.isFinite(value) && value > 0 && value <= definition.maximum);
  });
  return valid ? parsed : null;
}

function withBodyFat(
  values: MeasurementValues,
  bodyFat: BodyFatMeasurement | null,
): MeasurementValues | null {
  const recorded = measurementDefinitions.some((definition) => values[definition.key] !== null);
  return recorded || bodyFat ? { ...values, bodyFat } : null;
}

function parseBodyFatInput(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 75) return null;
  return Math.round((parsed + Number.EPSILON) * 10) / 10;
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
  if (measurement.values.bodyFat) {
    parts.unshift(
      `${tr(locale, 'Жир', 'Body fat')}: ${formatBodyFatPercent(measurement.values.bodyFat.percent, locale)}`,
    );
  }
  if (parts.length > 2) parts.length = 2;
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
  MeasurementDefinition['key'],
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
  key: PhysicalMeasurementKey,
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
