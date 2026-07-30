import { useEffect, useMemo, useState } from 'react';

import type { LocalWorkout } from '../lib/db';
import { tr, usePreferences } from '../lib/preferences';

type Props = {
  workout: LocalWorkout | null;
  onClose: () => void;
  onSave: (startedAt: string, durationSeconds: number) => void | Promise<void>;
};

export function WorkoutTimingSheet({ workout, onClose, onSave }: Props) {
  const { locale } = usePreferences();
  const initial = timingDraft(workout);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [hours, setHours] = useState(initial.hours);
  const [minutes, setMinutes] = useState(initial.minutes);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!workout) return;
    const next = timingDraft(workout);
    setDate(next.date);
    setTime(next.time);
    setHours(next.hours);
    setMinutes(next.minutes);
    setSaving(false);
  }, [workout?.id, workout?.startedAt, workout?.durationSeconds]);

  useEffect(() => {
    if (!workout) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [workout]);

  const parsedHours = parseWholeNumber(hours);
  const parsedMinutes = parseWholeNumber(minutes);
  const totalMinutes =
    parsedHours === null || parsedMinutes === null ? null : parsedHours * 60 + parsedMinutes;
  const startedAt = useMemo(() => {
    if (!date || !time) return null;
    const value = new Date(`${date}T${time}:00`);
    return Number.isNaN(value.getTime()) ? null : value;
  }, [date, time]);
  const valid =
    startedAt !== null &&
    parsedHours !== null &&
    parsedHours >= 0 &&
    parsedHours <= 24 &&
    parsedMinutes !== null &&
    parsedMinutes >= 0 &&
    parsedMinutes <= 59 &&
    totalMinutes !== null &&
    totalMinutes >= 1 &&
    totalMinutes <= 24 * 60;
  const endedAt =
    valid && startedAt && totalMinutes !== null
      ? new Date(startedAt.getTime() + totalMinutes * 60_000)
      : null;

  if (!workout) return null;

  function submit() {
    if (!valid || !startedAt || totalMinutes === null || saving) return;
    setSaving(true);
    void Promise.resolve(onSave(startedAt.toISOString(), totalMinutes * 60)).catch(() =>
      setSaving(false),
    );
  }

  return (
    <div className="sheet-backdrop timing-sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={tr(
          locale,
          'Исправить дату и длительность тренировки',
          'Edit workout date and duration',
        )}
        aria-modal="true"
        className="sheet workout-timing-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="sheet-handle" />
        <p className="eyebrow">{tr(locale, 'История тренировки', 'Workout history')}</p>
        <h2>{tr(locale, 'Дата и длительность', 'Date and duration')}</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="workout-timing-fields">
            <label>
              {tr(locale, 'Дата начала', 'Start date')}
              <input onChange={(event) => setDate(event.target.value)} type="date" value={date} />
            </label>
            <label>
              {tr(locale, 'Время начала', 'Start time')}
              <input onChange={(event) => setTime(event.target.value)} type="time" value={time} />
            </label>
            <label>
              {tr(locale, 'Часы', 'Hours')}
              <input
                inputMode="numeric"
                max="24"
                min="0"
                onChange={(event) => setHours(event.target.value)}
                type="number"
                value={hours}
              />
            </label>
            <label>
              {tr(locale, 'Минуты', 'Minutes')}
              <input
                inputMode="numeric"
                max="59"
                min="0"
                onChange={(event) => setMinutes(event.target.value)}
                type="number"
                value={minutes}
              />
            </label>
          </div>
          <p className={valid ? 'timing-result' : 'timing-result error'} role="status">
            {valid && endedAt
              ? tr(
                  locale,
                  `Окончание: ${formatLocalDateTime(endedAt, locale)}`,
                  `Ends: ${formatLocalDateTime(endedAt, locale)}`,
                )
              : tr(
                  locale,
                  'Укажи длительность от 1 минуты до 24 часов.',
                  'Enter a duration from 1 minute to 24 hours.',
                )}
          </p>
          <div className="sheet-actions">
            <button className="button ghost" onClick={onClose} type="button">
              {tr(locale, 'Отмена', 'Cancel')}
            </button>
            <button className="button primary" disabled={!valid || saving} type="submit">
              {saving ? tr(locale, 'Сохраняем…', 'Saving…') : tr(locale, 'Сохранить', 'Save')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function parseWholeNumber(value: string) {
  if (!/^\d+$/u.test(value)) return null;
  return Number(value);
}

function timingDraft(workout: LocalWorkout | null) {
  if (!workout) return { date: '', time: '', hours: '0', minutes: '1' };
  const started = new Date(workout.startedAt);
  const totalMinutes = Math.max(1, Math.round(workout.durationSeconds / 60));
  return {
    date: localDateValue(started),
    time: localTimeValue(started),
    hours: String(Math.floor(totalMinutes / 60)),
    minutes: String(totalMinutes % 60),
  };
}

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localTimeValue(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatLocalDateTime(date: Date, locale: 'ru' | 'en') {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
