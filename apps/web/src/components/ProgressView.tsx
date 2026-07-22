import { useMemo, useState } from 'react';

import type { Exercise } from '@mighty-cringe/contracts';

import type { LocalMeasurement, LocalSet, LocalWorkout } from '../lib/db';
import { setEntrySourceSuffix } from '../lib/setEntrySource';
import {
  buildCalendarMonth,
  buildExerciseProgress,
  buildWorkoutDays,
  calculateStreaks,
  dateKeyInTimeZone,
  volumeForRecentDays,
  type ExerciseProgressPoint,
} from '../lib/progress';
import { BodyMeasurementsSection, type MeasurementDraft } from './BodyMeasurementsSection';

const weekdayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const muscleLabels: Record<string, string> = {
  chest: 'Грудь',
  back: 'Спина',
  front_delt: 'Передняя дельта',
  middle_delt: 'Средняя дельта',
  rear_delt: 'Задняя дельта',
  biceps: 'Бицепс',
  triceps: 'Трицепс',
  quadriceps: 'Квадрицепс',
  hamstrings: 'Задняя поверхность бедра',
  calves: 'Икры',
  core: 'Кор',
};

export function ProgressView({
  workouts,
  sets,
  exercises,
  measurements,
  onDeleteMeasurement,
  onImportMeasurements,
  onSaveMeasurement,
}: {
  workouts: LocalWorkout[];
  sets: LocalSet[];
  exercises: Exercise[];
  measurements: LocalMeasurement[];
  onDeleteMeasurement: (measurement: LocalMeasurement) => void;
  onImportMeasurements: (drafts: MeasurementDraft[]) => Promise<void>;
  onSaveMeasurement: (draft: MeasurementDraft, existing: LocalMeasurement | null) => Promise<void>;
}) {
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const todayKey = dateKeyInTimeZone(new Date(), timeZone);
  const visibleSets = useMemo(() => sets.filter((set) => !set.deleted), [sets]);
  const workoutDays = useMemo(
    () => buildWorkoutDays(workouts, visibleSets, timeZone),
    [sets, timeZone, visibleSets, workouts],
  );
  const streaks = useMemo(
    () =>
      calculateStreaks(
        workoutDays.map((day) => day.dateKey),
        todayKey,
      ),
    [todayKey, workoutDays],
  );
  const [monthOverride, setMonthOverride] = useState<string | null>(null);
  const latestDay = workoutDays.at(-1)?.dateKey;
  const monthKey = monthOverride ?? (latestDay ?? todayKey).slice(0, 7);
  const calendar = useMemo(
    () => buildCalendarMonth(monthKey, workoutDays, todayKey),
    [monthKey, todayKey, workoutDays],
  );
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const selectedDay =
    calendar.find((day) => day.dateKey === selectedDayKey && day.workout) ??
    [...calendar].reverse().find((day) => day.inMonth && day.workout) ??
    null;
  const completedWorkouts = workouts.filter((workout) => workout.endedAt !== null);
  const completedIds = new Set(completedWorkouts.map((workout) => workout.id));
  const trackedExerciseIds = new Set(
    visibleSets.filter((set) => completedIds.has(set.workoutId)).map((set) => set.exerciseId),
  );
  const trackedExercises = exercises.filter((exercise) => trackedExerciseIds.has(exercise.id));
  const muscleGroups = [
    ...new Set(trackedExercises.flatMap((exercise) => exercise.primaryMuscles)),
  ];
  const [selectedMuscle, setSelectedMuscle] = useState('all');
  const [selectedExerciseId, setSelectedExerciseId] = useState('');
  const filteredExercises =
    selectedMuscle === 'all'
      ? trackedExercises
      : trackedExercises.filter((exercise) =>
          exercise.primaryMuscles.some((muscle) => muscle === selectedMuscle),
        );
  const selectedExercise =
    filteredExercises.find((exercise) => exercise.id === selectedExerciseId) ??
    filteredExercises[0];
  const strengthPoints = useMemo(
    () =>
      selectedExercise
        ? buildExerciseProgress(selectedExercise.id, workouts, visibleSets, timeZone)
        : [],
    [selectedExercise, timeZone, visibleSets, workouts],
  );
  const bestPoint = strengthPoints.reduce<ExerciseProgressPoint | null>(
    (best, point) =>
      !best || point.estimatedOneRepMaxKg > best.estimatedOneRepMaxKg ? point : best,
    null,
  );
  const volume30Days = volumeForRecentDays(workoutDays, todayKey);
  const hasUnsyncedData = workoutDays.some((day) => day.hasUnsyncedData);

  function showAdjacentMonth(amount: number) {
    setMonthOverride(moveMonth(monthKey, amount));
    setSelectedDayKey(null);
  }

  return (
    <section className="screen progress-screen">
      <p className="eyebrow">Твоё движение</p>
      <h1>Прогресс</h1>
      <p className="intro">
        Здесь только твои завершённые тренировки. День раскрывает исходные подходы, а история под
        графиком — расчёт каждой точки.
      </p>

      {hasUnsyncedData && (
        <p className="progress-notice">Локальные изменения уже учтены и ещё синхронизируются.</p>
      )}

      <div className="progress-summary" aria-label="Сводка прогресса">
        <SummaryMetric label="Тренировок" value={String(completedWorkouts.length)} />
        <SummaryMetric label="Текущая серия" value={formatDays(streaks.current)} />
        <SummaryMetric label="Лучшая серия" value={formatDays(streaks.best)} />
        <SummaryMetric label="Объём · 30 дней" value={formatKg(volume30Days)} />
      </div>
      <p className="streak-note">Серия остаётся текущей до конца сегодняшнего дня.</p>

      <section className="progress-section" aria-labelledby="calendar-heading">
        <div className="section-head progress-heading">
          <div>
            <p className="eyebrow">Ритм</p>
            <h2 id="calendar-heading">Календарь тренировок</h2>
          </div>
          <div className="month-controls">
            <button
              aria-label="Предыдущий месяц"
              onClick={() => showAdjacentMonth(-1)}
              type="button"
            >
              ←
            </button>
            <strong>{formatMonth(monthKey)}</strong>
            <button aria-label="Следующий месяц" onClick={() => showAdjacentMonth(1)} type="button">
              →
            </button>
          </div>
        </div>
        <div className="calendar-weekdays" aria-hidden="true">
          {weekdayLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="workout-calendar">
          {calendar.map((day) => (
            <button
              aria-label={`${formatDate(day.dateKey)}${day.workout ? `, тренировок: ${day.workout.workoutCount}` : ''}`}
              className={[
                'calendar-day',
                !day.inMonth && 'outside',
                day.isToday && 'today',
                day.workout && 'trained',
                day.dateKey === selectedDay?.dateKey && 'selected',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={!day.inMonth}
              key={day.dateKey}
              onClick={() => day.workout && setSelectedDayKey(day.dateKey)}
              type="button"
            >
              <span>{day.dayOfMonth}</span>
              {day.workout && <i>{day.workout.workoutCount > 1 ? day.workout.workoutCount : ''}</i>}
            </button>
          ))}
        </div>
        {selectedDay?.workout ? (
          <DayDetails
            dateKey={selectedDay.dateKey}
            exercises={exercises}
            sets={visibleSets}
            workoutIds={selectedDay.workout.workoutIds}
            workouts={workouts}
          />
        ) : (
          <p className="progress-empty compact">В этом месяце пока нет завершённых тренировок.</p>
        )}
      </section>

      <section className="progress-section" aria-labelledby="strength-heading">
        <div className="section-head progress-heading">
          <div>
            <p className="eyebrow">Сила</p>
            <h2 id="strength-heading">Рабочий вес и расчётный 1RM</h2>
          </div>
        </div>
        {trackedExercises.length ? (
          <>
            <div className="muscle-filters" aria-label="Группа мышц">
              <FilterChip
                active={selectedMuscle === 'all'}
                label="Все"
                onClick={() => {
                  setSelectedMuscle('all');
                  setSelectedExerciseId('');
                }}
              />
              {muscleGroups.map((muscle) => (
                <FilterChip
                  active={selectedMuscle === muscle}
                  key={muscle}
                  label={muscleLabels[muscle] ?? muscle}
                  onClick={() => {
                    setSelectedMuscle(muscle);
                    setSelectedExerciseId('');
                  }}
                />
              ))}
            </div>
            <label className="progress-select">
              Упражнение
              <select
                onChange={(event) => setSelectedExerciseId(event.target.value)}
                value={selectedExercise?.id ?? ''}
              >
                {filteredExercises.map((exercise) => (
                  <option key={exercise.id} value={exercise.id}>
                    {exercise.nameRu}
                  </option>
                ))}
              </select>
            </label>
            <StrengthChart points={strengthPoints} />
            {bestPoint && (
              <article className="one-rep-explainer">
                <div>
                  <span>Личный расчётный рекорд</span>
                  <strong>{formatKg(bestPoint.estimatedOneRepMaxKg)}</strong>
                </div>
                <p>
                  {formatKg(bestPoint.sourceSet.weightKg)} × {bestPoint.sourceSet.reps} повторов
                  {bestPoint.sourceSet.rir === null
                    ? ''
                    : ` · RIR ${bestPoint.sourceSet.rir}`} · {formatDate(bestPoint.dateKey)}
                </p>
                <small>
                  Epley: вес × (1 + (повторы + RIR) / 30). Это ориентир для сравнения твоих
                  тренировок, а не обещание реального максимума.
                </small>
              </article>
            )}
            <div className="strength-history">
              {[...strengthPoints]
                .reverse()
                .slice(0, 5)
                .map((point) => (
                  <article key={point.workoutId}>
                    <time dateTime={point.dateKey}>{formatDate(point.dateKey)}</time>
                    <span>
                      {point.setCount} подх. · {formatKg(point.volumeKg)} объёма
                    </span>
                    <strong>
                      {formatKg(point.topWeightKg)} рабочий · {formatKg(point.estimatedOneRepMaxKg)}{' '}
                      1RM
                    </strong>
                  </article>
                ))}
            </div>
          </>
        ) : (
          <p className="progress-empty">
            После первой завершённой тренировки здесь появится честная динамика по каждому
            упражнению.
          </p>
        )}
      </section>

      <BodyMeasurementsSection
        measurements={measurements}
        onDelete={onDeleteMeasurement}
        onImport={onImportMeasurements}
        onSave={onSaveMeasurement}
      />
    </section>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? 'active' : ''} onClick={onClick} type="button">
      {label}
    </button>
  );
}

function DayDetails({
  dateKey,
  workoutIds,
  workouts,
  sets,
  exercises,
}: {
  dateKey: string;
  workoutIds: string[];
  workouts: LocalWorkout[];
  sets: LocalSet[];
  exercises: Exercise[];
}) {
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  return (
    <div className="calendar-details">
      <strong>{formatDate(dateKey)}</strong>
      {workoutIds.map((workoutId) => {
        const workout = workouts.find((candidate) => candidate.id === workoutId);
        const workoutSets = sets
          .filter((set) => set.workoutId === workoutId)
          .sort((left, right) => left.position - right.position);
        const grouped = new Map<string, LocalSet[]>();
        for (const set of workoutSets) {
          grouped.set(set.exerciseId, [...(grouped.get(set.exerciseId) ?? []), set]);
        }
        return (
          <article key={workoutId}>
            <div>
              <span>{workout?.endedAt ? formatTime(workout.endedAt) : 'Завершена'}</span>
              {workout?.syncState !== 'synced' && <em>синхронизируется</em>}
            </div>
            {grouped.size ? (
              [...grouped.entries()].map(([exerciseId, exerciseSets]) => (
                <p key={exerciseId}>
                  <b>{exerciseById.get(exerciseId)?.nameRu ?? 'Упражнение'}</b>
                  <span>
                    {exerciseSets
                      .map(
                        (set) =>
                          `${formatNumber(set.weightKg)}×${set.reps}${set.rir === null ? '' : ` @${set.rir}`}${setEntrySourceSuffix(set.entrySource)}`,
                      )
                      .join(' · ')}
                  </span>
                </p>
              ))
            ) : (
              <p>Тренировка без записанных подходов.</p>
            )}
          </article>
        );
      })}
    </div>
  );
}

function StrengthChart({ points }: { points: ExerciseProgressPoint[] }) {
  if (!points.length)
    return <p className="progress-empty compact">Для упражнения ещё нет данных.</p>;

  const visible = points.slice(-12);
  const maximum = Math.max(
    1,
    ...visible.flatMap((point) => [point.topWeightKg, point.estimatedOneRepMaxKg]),
  );
  const coordinates = (selector: (point: ExerciseProgressPoint) => number) =>
    visible
      .map((point, index) => {
        const x = visible.length === 1 ? 160 : 22 + (index / (visible.length - 1)) * 276;
        const y = 142 - (selector(point) / maximum) * 112;
        return `${x},${y}`;
      })
      .join(' ');

  return (
    <div className="strength-chart">
      <div className="chart-legend">
        <span className="weight">Рабочий вес</span>
        <span className="estimated">Расчётный 1RM</span>
      </div>
      <svg aria-label="График рабочего веса и расчётного 1RM" role="img" viewBox="0 0 320 170">
        {[30, 86, 142].map((y) => (
          <line className="chart-grid" key={y} x1="22" x2="298" y1={y} y2={y} />
        ))}
        <polyline
          className="chart-line estimated"
          points={coordinates((point) => point.estimatedOneRepMaxKg)}
        />
        <polyline
          className="chart-line weight"
          points={coordinates((point) => point.topWeightKg)}
        />
        {visible.map((point, index) => {
          const x = visible.length === 1 ? 160 : 22 + (index / (visible.length - 1)) * 276;
          const weightY = 142 - (point.topWeightKg / maximum) * 112;
          const estimatedY = 142 - (point.estimatedOneRepMaxKg / maximum) * 112;
          return (
            <g key={point.workoutId}>
              <circle className="chart-point estimated" cx={x} cy={estimatedY} r="3.5">
                <title>{`${formatDate(point.dateKey)}: ${formatKg(point.estimatedOneRepMaxKg)} расчётный 1RM`}</title>
              </circle>
              <circle className="chart-point weight" cx={x} cy={weightY} r="3.5">
                <title>{`${formatDate(point.dateKey)}: ${formatKg(point.topWeightKg)} рабочий вес`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
      <div className="chart-range">
        <span>{formatDate(visible[0].dateKey)}</span>
        <span>{formatDate(visible.at(-1)!.dateKey)}</span>
      </div>
    </div>
  );
}

function moveMonth(monthKey: string, amount: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return date.toISOString().slice(0, 7);
}

function formatMonth(monthKey: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${monthKey}-01T12:00:00Z`));
}

function formatDate(dateKey: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  );
}

function formatDays(value: number): string {
  return `${value} ${value % 10 === 1 && value % 100 !== 11 ? 'день' : value % 10 >= 2 && value % 10 <= 4 && (value % 100 < 10 || value % 100 >= 20) ? 'дня' : 'дней'}`;
}

function formatKg(value: number): string {
  return `${formatNumber(value)} кг`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
}
