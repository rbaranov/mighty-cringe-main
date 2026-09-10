import { useEffect, useMemo, useRef, useState } from 'react';

import type { Exercise } from '@mighty-cringe/contracts';

import type { LocalMeasurement, LocalSet, LocalWorkout } from '../lib/db';
import { exerciseName, formatWeight, tr, usePreferences } from '../lib/preferences';
import { setEntrySourceSuffix } from '../lib/setEntrySource';
import { formatWorkoutDurationSeconds } from '../lib/workoutLifecycle';
import {
  buildCalendarMonth,
  buildExerciseProgress,
  buildWorkoutDays,
  calculateWeeklyStreaks,
  dateKeyInTimeZone,
  volumeForRecentDays,
  volumeForPreviousDays,
  workoutCountForMonth,
  workoutCountForYear,
  type ExerciseProgressPoint,
} from '../lib/progress';
import { BodyMeasurementsSection, type MeasurementDraft } from './BodyMeasurementsSection';
import { StarIcon } from './StarIcon';

const weekdayLabels = {
  ru: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};

const muscleLabels: Record<string, [string, string]> = {
  chest: ['Грудь', 'Chest'],
  back: ['Спина', 'Back'],
  front_delt: ['Передняя дельта', 'Front delts'],
  middle_delt: ['Средняя дельта', 'Middle delts'],
  rear_delt: ['Задняя дельта', 'Rear delts'],
  biceps: ['Бицепс', 'Biceps'],
  triceps: ['Трицепс', 'Triceps'],
  quadriceps: ['Квадрицепс', 'Quadriceps'],
  hamstrings: ['Задняя поверхность бедра', 'Hamstrings'],
  glutes: ['Ягодицы', 'Glutes'],
  adductors: ['Приводящие мышцы', 'Adductors'],
  calves: ['Икры', 'Calves'],
  core: ['Кор', 'Core'],
};

type ProgressSummaryTip = 'month' | 'streak';

export function ProgressView({
  workouts,
  sets,
  exercises,
  measurements,
  onDeleteMeasurement,
  onDeleteWorkout,
  onEditWorkout,
  onEditFavoriteName,
  onImportMeasurements,
  onRepeatWorkout,
  onResumeWorkout,
  onSaveMeasurement,
  onToggleFavorite,
}: {
  workouts: LocalWorkout[];
  sets: LocalSet[];
  exercises: Exercise[];
  measurements: LocalMeasurement[];
  onDeleteMeasurement: (measurement: LocalMeasurement) => void;
  onDeleteWorkout: (workout: LocalWorkout) => void;
  onEditWorkout: (workout: LocalWorkout) => void;
  onEditFavoriteName: (workout: LocalWorkout) => void;
  onImportMeasurements: (drafts: MeasurementDraft[]) => Promise<void>;
  onRepeatWorkout: (workout: LocalWorkout) => void;
  onResumeWorkout: (workout: LocalWorkout) => void;
  onSaveMeasurement: (draft: MeasurementDraft, existing: LocalMeasurement | null) => Promise<void>;
  onToggleFavorite: (workout: LocalWorkout) => void;
}) {
  const { locale, unitSystem } = usePreferences();
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const todayKey = dateKeyInTimeZone(new Date(), timeZone);
  const visibleSets = useMemo(() => sets.filter((set) => !set.deleted), [sets]);
  const workoutDays = useMemo(
    () => buildWorkoutDays(workouts, visibleSets, timeZone),
    [sets, timeZone, visibleSets, workouts],
  );
  const countedWorkoutDays = useMemo(
    () => workoutDays.filter((day) => day.workoutCount > 0),
    [workoutDays],
  );
  const streaks = useMemo(
    () =>
      calculateWeeklyStreaks(
        countedWorkoutDays.map((day) => day.dateKey),
        todayKey,
      ),
    [countedWorkoutDays, todayKey],
  );
  const [summaryTip, setSummaryTip] = useState<ProgressSummaryTip | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const [monthOverride, setMonthOverride] = useState<string | null>(null);
  const currentMonth = todayKey.slice(0, 7);
  const currentYear = todayKey.slice(0, 4);
  const monthKey = monthOverride ?? currentMonth;
  const calendar = useMemo(
    () => buildCalendarMonth(monthKey, workoutDays, todayKey),
    [monthKey, todayKey, workoutDays],
  );
  const currentMonthWorkoutCount = workoutCountForMonth(workoutDays, currentMonth);
  const currentYearWorkoutCount = workoutCountForYear(workoutDays, currentYear);
  const monthWorkoutCount = workoutCountForMonth(workoutDays, monthKey);
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
  const previousVolume30Days = volumeForPreviousDays(workoutDays, todayKey);
  const hasUnsyncedData = workoutDays.some((day) => day.hasUnsyncedData);

  function showAdjacentMonth(amount: number) {
    const candidate = moveMonth(monthKey, amount);
    if (candidate > currentMonth) return;
    setMonthOverride(candidate);
    setSelectedDayKey(null);
  }

  function showCurrentMonth() {
    setMonthOverride(null);
    setSelectedDayKey(null);
  }

  useEffect(() => {
    if (!summaryTip) return;

    function closeSummaryTip(event: PointerEvent) {
      if (!(event.target instanceof Node) || summaryRef.current?.contains(event.target)) return;
      setSummaryTip(null);
    }

    function closeSummaryTipOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setSummaryTip(null);
      summaryRef.current
        ?.querySelector<HTMLButtonElement>(`[data-progress-summary-id="${summaryTip}"]`)
        ?.focus();
    }

    document.addEventListener('pointerdown', closeSummaryTip);
    document.addEventListener('keydown', closeSummaryTipOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeSummaryTip);
      document.removeEventListener('keydown', closeSummaryTipOnEscape);
    };
  }, [summaryTip]);

  return (
    <section className="screen progress-screen">
      <p className="eyebrow">{tr(locale, 'Твоё движение', 'Your movement')}</p>
      <h1>{tr(locale, 'Прогресс', 'Progress')}</h1>
      <p className="intro">
        {tr(
          locale,
          'Здесь только твои завершённые тренировки. День раскрывает исходные подходы, а история под графиком — расчёт каждой точки.',
          'Only your completed workouts appear here. Open a day to see the original sets and use the history below the chart to verify every point.',
        )}
      </p>

      {hasUnsyncedData && (
        <p className="progress-notice">
          {tr(
            locale,
            'Локальные изменения уже учтены и ещё синхронизируются.',
            'Local changes are included and are still syncing.',
          )}
        </p>
      )}

      <div
        className="progress-summary"
        aria-label={tr(locale, 'Сводка прогресса', 'Progress summary')}
        ref={summaryRef}
      >
        <SummaryMetric
          active={summaryTip === 'month'}
          align="start"
          detail={tr(
            locale,
            `${currentYearWorkoutCount} за ${currentYear} год`,
            `${currentYearWorkoutCount} in ${currentYear}`,
          )}
          id="month"
          label={formatMonthlyWorkoutLabel(currentMonth, locale)}
          onToggle={() => setSummaryTip((current) => (current === 'month' ? null : 'month'))}
          tooltip={tr(
            locale,
            `За ${currentYear} год: ${currentYearWorkoutCount}. Учитываются завершённые тренировки хотя бы с одним подходом — по дню начала в твоём местном времени.`,
            `${currentYearWorkoutCount} in ${currentYear}. Completed workouts with at least one set are counted by their local start day.`,
          )}
          value={String(currentMonthWorkoutCount)}
        />
        <SummaryMetric
          active={summaryTip === 'streak'}
          align="end"
          detail={tr(
            locale,
            `рекорд: ${formatWeeks(streaks.best, locale)}`,
            `record: ${formatWeeks(streaks.best, locale)}`,
          )}
          id="streak"
          label={tr(locale, 'Текущая серия', 'Current streak')}
          onToggle={() => setSummaryTip((current) => (current === 'streak' ? null : 'streak'))}
          tooltip={tr(
            locale,
            'Неделя засчитывается после первой завершённой тренировки хотя бы с одним подходом. Для продолжения нужна такая тренировка в каждой следующей календарной неделе.',
            'A week counts after the first completed workout with at least one set. Continue with one such workout in every following calendar week.',
          )}
          value={formatWeeks(streaks.current, locale)}
        />
      </div>

      <section className="progress-section" aria-labelledby="calendar-heading">
        <div className="section-head progress-heading">
          <div>
            <p className="eyebrow">{tr(locale, 'Ритм', 'Rhythm')}</p>
            <h2 id="calendar-heading">{tr(locale, 'Календарь тренировок', 'Workout calendar')}</h2>
          </div>
          <div className="month-navigation">
            <div className="month-controls">
              <button
                aria-label={tr(locale, 'Предыдущий месяц', 'Previous month')}
                onClick={() => showAdjacentMonth(-1)}
                type="button"
              >
                ←
              </button>
              <strong>{formatMonth(monthKey, locale)}</strong>
              <button
                aria-label={tr(locale, 'Следующий месяц', 'Next month')}
                disabled={monthKey >= currentMonth}
                onClick={() => showAdjacentMonth(1)}
                type="button"
              >
                →
              </button>
            </div>
            {monthKey !== currentMonth && (
              <button className="current-month-button" onClick={showCurrentMonth} type="button">
                {tr(locale, 'К текущему месяцу', 'Current month')}
              </button>
            )}
          </div>
        </div>
        <p className="calendar-month-count">{formatWorkoutCount(monthWorkoutCount, locale)}</p>
        <div className="calendar-weekdays" aria-hidden="true">
          {weekdayLabels[locale].map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="workout-calendar">
          {calendar.map((day) => (
            <button
              aria-label={`${formatDate(day.dateKey, locale)}${day.workout ? tr(locale, `, тренировок: ${day.workout.workoutCount}`, `, workouts: ${day.workout.workoutCount}`) : ''}`}
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
            onDeleteWorkout={onDeleteWorkout}
            onEditWorkout={onEditWorkout}
            onEditFavoriteName={onEditFavoriteName}
            onRepeatWorkout={onRepeatWorkout}
            onResumeWorkout={onResumeWorkout}
            onToggleFavorite={onToggleFavorite}
            sets={visibleSets}
            workoutIds={selectedDay.workout.workoutIds}
            workouts={workouts}
          />
        ) : (
          <p className="progress-empty compact">
            {tr(
              locale,
              'В этом месяце пока нет завершённых тренировок.',
              'No completed workouts this month yet.',
            )}
          </p>
        )}
      </section>

      <section className="progress-section" aria-labelledby="strength-heading">
        <div className="section-head progress-heading">
          <div>
            <p className="eyebrow">{tr(locale, 'Сила', 'Strength')}</p>
            <h2 id="strength-heading">
              {tr(locale, 'Рабочий вес и расчётный 1RM', 'Working weight and estimated 1RM')}
            </h2>
          </div>
        </div>
        <article className="training-volume-card">
          <span>{tr(locale, 'Объём за 30 дней', 'Volume over 30 days')}</span>
          <strong>{formatWeight(volume30Days, locale, unitSystem)}</strong>
          <small>{formatVolumeComparison(volume30Days, previousVolume30Days, locale)}</small>
        </article>
        {trackedExercises.length ? (
          <>
            <div className="muscle-filters" aria-label={tr(locale, 'Группа мышц', 'Muscle group')}>
              <FilterChip
                active={selectedMuscle === 'all'}
                label={tr(locale, 'Все', 'All')}
                onClick={() => {
                  setSelectedMuscle('all');
                  setSelectedExerciseId('');
                }}
              />
              {muscleGroups.map((muscle) => (
                <FilterChip
                  active={selectedMuscle === muscle}
                  key={muscle}
                  label={muscleLabels[muscle]?.[locale === 'en' ? 1 : 0] ?? muscle}
                  onClick={() => {
                    setSelectedMuscle(muscle);
                    setSelectedExerciseId('');
                  }}
                />
              ))}
            </div>
            <label className="progress-select">
              {tr(locale, 'Упражнение', 'Exercise')}
              <select
                onChange={(event) => setSelectedExerciseId(event.target.value)}
                value={selectedExercise?.id ?? ''}
              >
                {filteredExercises.map((exercise) => (
                  <option key={exercise.id} value={exercise.id}>
                    {exerciseName(exercise, locale)}
                  </option>
                ))}
              </select>
            </label>
            <StrengthChart points={strengthPoints} />
            {bestPoint && (
              <article className="one-rep-explainer">
                <div>
                  <span>{tr(locale, 'Личный расчётный рекорд', 'Personal estimated record')}</span>
                  <strong>
                    {formatWeight(bestPoint.estimatedOneRepMaxKg, locale, unitSystem)}
                  </strong>
                </div>
                <p>
                  {formatWeight(bestPoint.sourceSet.weightKg, locale, unitSystem)} ×{' '}
                  {bestPoint.sourceSet.reps} {tr(locale, 'повторов', 'reps')}
                  {bestPoint.sourceSet.rir === null
                    ? ''
                    : ` · RIR ${bestPoint.sourceSet.rir}`} · {formatDate(bestPoint.dateKey, locale)}
                </p>
                <small>
                  {tr(
                    locale,
                    'Epley: вес × (1 + (повторы + RIR) / 30). Это ориентир для сравнения твоих тренировок, а не обещание реального максимума.',
                    'Epley: weight × (1 + (reps + RIR) / 30). This is a comparison estimate, not a promise of your actual maximum.',
                  )}
                </small>
              </article>
            )}
            <div className="strength-history">
              {[...strengthPoints]
                .reverse()
                .slice(0, 5)
                .map((point) => (
                  <article key={point.workoutId}>
                    <time dateTime={point.dateKey}>{formatDate(point.dateKey, locale)}</time>
                    <span>
                      {point.setCount} {tr(locale, 'подх.', 'sets')} ·{' '}
                      {formatWeight(point.volumeKg, locale, unitSystem)}{' '}
                      {tr(locale, 'объёма', 'volume')}
                    </span>
                    <strong>
                      {formatWeight(point.topWeightKg, locale, unitSystem)}{' '}
                      {tr(locale, 'рабочий', 'working')} ·{' '}
                      {formatWeight(point.estimatedOneRepMaxKg, locale, unitSystem)} 1RM
                    </strong>
                  </article>
                ))}
            </div>
          </>
        ) : (
          <p className="progress-empty">
            {tr(
              locale,
              'После первой завершённой тренировки здесь появится честная динамика по каждому упражнению.',
              'Complete your first workout to see progress for each exercise.',
            )}
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

function SummaryMetric({
  active,
  align,
  detail,
  id,
  label,
  onToggle,
  tooltip,
  value,
}: {
  active: boolean;
  align: 'start' | 'end';
  detail: string;
  id: ProgressSummaryTip;
  label: string;
  onToggle: () => void;
  tooltip: string;
  value: string;
}) {
  const tooltipId = `progress-summary-tooltip-${id}`;
  return (
    <div className={`progress-summary-popover ${align}`}>
      <button
        aria-describedby={active ? tooltipId : undefined}
        aria-expanded={active}
        className={active ? 'progress-summary-card active' : 'progress-summary-card'}
        data-progress-summary-id={id}
        onClick={onToggle}
        type="button"
      >
        <strong>{value}</strong>
        <span>{label}</span>
        <small>{detail}</small>
      </button>
      {active && (
        <span className="progress-summary-tooltip" id={tooltipId} role="tooltip">
          {tooltip}
        </span>
      )}
    </div>
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
  onDeleteWorkout,
  onEditWorkout,
  onEditFavoriteName,
  onRepeatWorkout,
  onResumeWorkout,
  onToggleFavorite,
}: {
  dateKey: string;
  workoutIds: string[];
  workouts: LocalWorkout[];
  sets: LocalSet[];
  exercises: Exercise[];
  onDeleteWorkout: (workout: LocalWorkout) => void;
  onEditWorkout: (workout: LocalWorkout) => void;
  onEditFavoriteName: (workout: LocalWorkout) => void;
  onRepeatWorkout: (workout: LocalWorkout) => void;
  onResumeWorkout: (workout: LocalWorkout) => void;
  onToggleFavorite: (workout: LocalWorkout) => void;
}) {
  const { locale, unitSystem } = usePreferences();
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  return (
    <div className="calendar-details">
      <strong>{formatDate(dateKey, locale)}</strong>
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
              <span>
                {workout
                  ? `${formatTime(workout.startedAt, locale)} · ${formatWorkoutDurationSeconds(workout.durationSeconds, locale)}`
                  : tr(locale, 'Завершена', 'Completed')}
              </span>
              {workout?.completionReason === 'automatic' && (
                <em className="automatic-completion-label">
                  {tr(locale, 'завершена автоматически', 'finished automatically')}
                </em>
              )}
              {workout?.syncState !== 'synced' && (
                <em>{tr(locale, 'синхронизируется', 'syncing')}</em>
              )}
            </div>
            {workout?.notes && (
              <div className="workout-history-note">
                <strong>{tr(locale, 'Комментарий', 'Note')}</strong>
                <span>{workout.notes}</span>
              </div>
            )}
            {workout?.isFavorite && workout.favoriteName && (
              <div className="workout-history-favorite-name">
                <strong>{tr(locale, 'Избранная', 'Favorite')}</strong>
                <span>{workout.favoriteName}</span>
              </div>
            )}
            {workout && (
              <div className="workout-history-actions">
                <button
                  className="button ghost small"
                  onClick={() => onEditWorkout(workout)}
                  type="button"
                >
                  {tr(locale, 'Редактировать', 'Edit')}
                </button>
                <button
                  className="button ghost small"
                  onClick={() => onResumeWorkout(workout)}
                  type="button"
                >
                  {tr(locale, 'Продолжить', 'Continue')}
                </button>
                <button
                  className="button primary small"
                  onClick={() => onRepeatWorkout(workout)}
                  type="button"
                >
                  {tr(locale, 'Повторить', 'Repeat')}
                </button>
                <button
                  className="button ghost small workout-delete"
                  onClick={() => onDeleteWorkout(workout)}
                  type="button"
                >
                  {tr(locale, 'Удалить', 'Delete')}
                </button>
                {workout.isFavorite && (
                  <button
                    className="button ghost small"
                    onClick={() => onEditFavoriteName(workout)}
                    type="button"
                  >
                    {tr(locale, 'Название', 'Name')}
                  </button>
                )}
                <button
                  aria-label={tr(
                    locale,
                    workout.isFavorite
                      ? 'Убрать тренировку из избранного'
                      : 'Добавить тренировку в избранное',
                    workout.isFavorite
                      ? 'Remove workout from favorites'
                      : 'Add workout to favorites',
                  )}
                  aria-pressed={workout.isFavorite}
                  className={`favorite-toggle ${workout.isFavorite ? 'active' : ''}`}
                  onClick={() => onToggleFavorite(workout)}
                  type="button"
                >
                  <StarIcon filled={workout.isFavorite} />
                </button>
              </div>
            )}
            {grouped.size ? (
              [...grouped.entries()].map(([exerciseId, exerciseSets]) => (
                <p key={exerciseId}>
                  <b>
                    {exerciseById.has(exerciseId)
                      ? exerciseName(exerciseById.get(exerciseId)!, locale)
                      : tr(locale, 'Упражнение', 'Exercise')}
                  </b>
                  <span>
                    {exerciseSets
                      .map(
                        (set) =>
                          `${formatWeight(set.weightKg, locale, unitSystem)}×${set.reps}${set.rir === null ? '' : ` @${set.rir}`}${setEntrySourceSuffix(set.entrySource, locale)}`,
                      )
                      .join(' · ')}
                  </span>
                </p>
              ))
            ) : (
              <p>
                {tr(
                  locale,
                  '0 подходов · тренировка сохранена в истории.',
                  '0 sets · workout kept in history.',
                )}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}

function StrengthChart({ points }: { points: ExerciseProgressPoint[] }) {
  const { locale, unitSystem } = usePreferences();
  if (!points.length)
    return (
      <p className="progress-empty compact">
        {tr(locale, 'Для упражнения ещё нет данных.', 'No data for this exercise yet.')}
      </p>
    );

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
        <span className="weight">{tr(locale, 'Рабочий вес', 'Working weight')}</span>
        <span className="estimated">{tr(locale, 'Расчётный 1RM', 'Estimated 1RM')}</span>
      </div>
      <svg
        aria-label={tr(
          locale,
          'График рабочего веса и расчётного 1RM',
          'Working weight and estimated 1RM chart',
        )}
        role="img"
        viewBox="0 0 320 170"
      >
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
                <title>{`${formatDate(point.dateKey, locale)}: ${formatWeight(point.estimatedOneRepMaxKg, locale, unitSystem)} ${tr(locale, 'расчётный 1RM', 'estimated 1RM')}`}</title>
              </circle>
              <circle className="chart-point weight" cx={x} cy={weightY} r="3.5">
                <title>{`${formatDate(point.dateKey, locale)}: ${formatWeight(point.topWeightKg, locale, unitSystem)} ${tr(locale, 'рабочий вес', 'working weight')}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
      <div className="chart-range">
        <span>{formatDate(visible[0].dateKey, locale)}</span>
        <span>{formatDate(visible.at(-1)!.dateKey, locale)}</span>
      </div>
    </div>
  );
}

function moveMonth(monthKey: string, amount: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return date.toISOString().slice(0, 7);
}

function formatMonth(monthKey: string, locale: 'ru' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${monthKey}-01T12:00:00Z`));
}

function formatDate(dateKey: string, locale: 'ru' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

function formatTime(value: string, locale: 'ru' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatWeeks(value: number, locale: 'ru' | 'en'): string {
  if (locale === 'en') return `${value} ${value === 1 ? 'week' : 'weeks'}`;
  return `${value} ${value % 10 === 1 && value % 100 !== 11 ? 'неделя' : value % 10 >= 2 && value % 10 <= 4 && (value % 100 < 10 || value % 100 >= 20) ? 'недели' : 'недель'}`;
}

function formatMonthlyWorkoutLabel(monthKey: string, locale: 'ru' | 'en'): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  if (locale === 'en') {
    const monthName = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      timeZone: 'UTC',
    }).format(date);
    return `workouts in ${monthName}`;
  }

  const monthName = [
    'январе',
    'феврале',
    'марте',
    'апреле',
    'мае',
    'июне',
    'июле',
    'августе',
    'сентябре',
    'октябре',
    'ноябре',
    'декабре',
  ][month - 1];
  return `тренировки в ${monthName}`;
}

function formatWorkoutCount(value: number, locale: 'ru' | 'en'): string {
  if (locale === 'en') return `${value} ${value === 1 ? 'workout' : 'workouts'}`;
  const noun =
    value % 10 === 1 && value % 100 !== 11
      ? 'тренировка'
      : value % 10 >= 2 && value % 10 <= 4 && (value % 100 < 10 || value % 100 >= 20)
        ? 'тренировки'
        : 'тренировок';
  return `${value} ${noun}`;
}

function formatVolumeComparison(current: number, previous: number, locale: 'ru' | 'en'): string {
  if (current === 0 && previous === 0) {
    return tr(locale, 'Пока нет данных за этот период', 'No data for this period yet');
  }
  if (previous === 0) {
    return tr(
      locale,
      'Первые данные — сравнение появится через 30 дней',
      'First data — comparison will appear after 30 days',
    );
  }

  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) {
    return tr(locale, 'Без изменений к предыдущим 30 дням', 'No change from the previous 30 days');
  }
  const prefix = change > 0 ? '+' : '−';
  return tr(
    locale,
    `${prefix}${Math.abs(change)}% к предыдущим 30 дням`,
    `${prefix}${Math.abs(change)}% vs the previous 30 days`,
  );
}
