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
  type MeasurementDefinition,
} from '../lib/measurements';
import { dateKeyInTimeZone } from '../lib/progress';

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
          <p className="eyebrow">Тело</p>
          <h2 id="body-heading">Замеры и вес</h2>
        </div>
        <div className="body-actions">
          <button className="button ghost small" onClick={() => setImporting(true)} type="button">
            Импорт CSV
          </button>
          <button className="button primary small" onClick={() => setEditing('new')} type="button">
            + Замер
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
            <span>Вся история замеров</span>
            <strong>{ordered.length}</strong>
            <i>{showHistory ? 'Скрыть' : 'Открыть'} →</i>
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
                    {formatMeasurementDate(measurement)}
                  </time>
                  <span>{measurementSummary(measurement)}</span>
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
          <strong>Начни с любой даты</strong>
          <span>
            Можно внести сегодняшний замер или импортировать старую запись — история выстроится
            автоматически.
          </span>
          <button className="button primary small" onClick={() => setEditing('new')} type="button">
            Добавить первый замер
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
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const parsed = useMemo(() => parseMeasurementCsv(text), [text]);
  const existingDates = new Set(
    existing.map((measurement) => dateKeyInTimeZone(measurement.measuredOn, timeZone)),
  );
  const duplicateErrors = parsed.rows
    .filter((row) => existingDates.has(row.dateKey))
    .map((row) => `Строка ${row.line}: за ${row.dateKey} уже есть запись.`);
  const errors = [...parsed.errors, ...duplicateErrors];

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
        <p className="eyebrow">История тела</p>
        <h2 id="measurement-import-title">Импорт CSV</h2>
        <p className="intro">
          Вставь строки из таблицы. Разделитель — точка с запятой, десятичная часть — запятая или
          точка. Обязательны «Дата» и хотя бы один замер.
        </p>
        <pre>Дата;Вес;Рост;Шея;Грудь;Бицепс;Бедро левое;Бедро правое;Икра;Талия;Самозамер</pre>
        <textarea
          aria-label="CSV с историей замеров"
          onChange={(event) => setText(event.target.value)}
          placeholder={'Дата;Вес;Грудь;Талия;Самозамер\n23.03.2025;82,5;103;91;да'}
          rows={8}
          value={text}
        />
        {text && (
          <div className={errors.length ? 'import-result error' : 'import-result'}>
            <strong>
              {errors.length
                ? `Нужно исправить: ${errors.length}`
                : `Готово к импорту: ${parsed.rows.length}`}
            </strong>
            {errors.slice(0, 5).map((error, index) => (
              <span key={`${index}-${error}`}>{error}</span>
            ))}
          </div>
        )}
        <div className="sheet-actions">
          <button className="button ghost" disabled={saving} onClick={onClose} type="button">
            Отмена
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
            {saving ? 'Импортирую…' : `Импортировать ${parsed.rows.length || ''}`}
          </button>
        </div>
      </section>
    </div>
  );
}

function MeasurementTrendCard({
  definition,
  measurements,
}: {
  definition: MeasurementDefinition;
  measurements: LocalMeasurement[];
}) {
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
        <span>{definition.shortLabel}</span>
        <strong>
          {latestValue === null ? '—' : `${formatValue(latestValue)} ${definition.unit}`}
        </strong>
        <small>{formatDelta(delta, definition.unit)}</small>
      </div>
      <Sparkline label={definition.label} values={trend.map((point) => point.value)} />
    </article>
  );
}

function Sparkline({ values, label }: { values: number[]; label: string }) {
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
    <svg aria-label={`Тренд: ${label}`} role="img" viewBox="0 0 120 44">
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
  const recorded = measurementDefinitions.filter(
    (definition) => measurement.values[definition.key] !== null,
  );
  return (
    <article className="measurement-detail">
      <header>
        <div>
          <span>Запись от</span>
          <strong>{formatMeasurementDate(measurement)}</strong>
        </div>
        <div className="measurement-actions">
          <button onClick={onEdit} type="button">
            Изменить
          </button>
          <button className="danger-text" onClick={onDelete} type="button">
            Удалить
          </button>
        </div>
      </header>
      {measurement.isSelfMeasured && <p className="self-measured">Самозамер</p>}
      <div className="measurement-values">
        {recorded.map((definition) => {
          const value = measurement.values[definition.key]!;
          const delta = measurementDelta(measurement, previous, definition.key);
          return (
            <div key={definition.key}>
              <span>{definition.label}</span>
              <strong>
                {formatValue(value)} {definition.unit}
              </strong>
              <small>{formatDelta(delta, definition.unit)}</small>
            </div>
          );
        })}
      </div>
      <p className="measurement-delta-note">
        {previous
          ? `Изменения показаны относительно ${formatMeasurementDate(previous)}.`
          : 'Это первая запись — сравнение появится после следующего замера.'}
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
          return [definition.key, value === null || value === undefined ? '' : String(value)];
        }),
      ),
    );
  }, [initial, timeZone, today]);

  const parsedValues = parseValues(values);
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
        <p className="eyebrow">История тела</p>
        <h2 id="measurement-sheet-title">{initial ? 'Изменить замер' : 'Новый замер'}</h2>
        <p className="intro">Выбери любую прошлую дату для импорта. Пустые поля не сохраняются.</p>
        <label className="measurement-date">
          Дата
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
            <strong>Самозамер</strong>
            <small>Измерение сделано самостоятельно</small>
          </span>
        </label>
        <div className="measurement-form-grid">
          {measurementDefinitions.map((definition) => (
            <label key={definition.key} title={definition.help}>
              <span>{definition.label}</span>
              <div>
                <input
                  inputMode="decimal"
                  max={definition.maximum}
                  min="0.1"
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [definition.key]: event.target.value }))
                  }
                  placeholder="—"
                  step="0.1"
                  type="number"
                  value={values[definition.key] ?? ''}
                />
                <small>{definition.unit}</small>
              </div>
              <em>{definition.help}</em>
            </label>
          ))}
        </div>
        {invalid && (
          <p className="measurement-error">Заполни хотя бы одно поле положительным числом.</p>
        )}
        {duplicateDate && (
          <p className="measurement-error">
            За эту дату уже есть замер — измени существующую запись.
          </p>
        )}
        <div className="sheet-actions">
          <button className="button ghost" disabled={saving} onClick={onClose} type="button">
            Отмена
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
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>
      </section>
    </div>
  );
}

function SyncBadge({ measurement }: { measurement: LocalMeasurement }) {
  if (measurement.syncState === 'synced') return null;
  return <em>{measurement.syncState === 'conflict' ? 'нужен выбор' : 'синхронизация'}</em>;
}

function parseValues(values: Record<string, string>): MeasurementValues | null {
  const parsed = Object.fromEntries(
    measurementDefinitions.map((definition) => {
      const raw = values[definition.key]?.trim().replace(',', '.') ?? '';
      return [definition.key, raw === '' ? null : Number(raw)];
    }),
  ) as MeasurementValues;
  const recorded = Object.values(parsed).filter((value): value is number => value !== null);
  const valid = measurementDefinitions.every((definition) => {
    const value = parsed[definition.key];
    return value === null || (Number.isFinite(value) && value > 0 && value <= definition.maximum);
  });
  return recorded.length && valid ? parsed : null;
}

function measurementSummary(measurement: LocalMeasurement): string {
  const parts = measurementDefinitions
    .filter((definition) => definition.featured && measurement.values[definition.key] !== null)
    .slice(0, 2)
    .map(
      (definition) =>
        `${definition.shortLabel}: ${formatValue(measurement.values[definition.key]!)} ${definition.unit}`,
    );
  return parts.join(' · ') || 'Запись замеров';
}

function formatMeasurementDate(measurement: LocalMeasurement): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(measurement.measuredOn));
}

function formatValue(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
}

function formatDelta(value: number | null, unit: string): string {
  if (value === null) return 'нет сравнения';
  if (Math.abs(value) < 0.05) return 'без изменений';
  return `${value > 0 ? '+' : '−'}${formatValue(Math.abs(value))} ${unit}`;
}
