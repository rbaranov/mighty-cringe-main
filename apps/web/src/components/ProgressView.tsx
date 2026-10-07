import { useEffect, useMemo, useRef, useState } from 'react';

import type { Exercise } from '@mighty-cringe/contracts';

import type { LocalMeasurement, LocalSet, LocalWorkout } from '../lib/db';
import {
  exerciseName,
  formatSourceWeight,
  formatWeight,
  tr,
  usePreferences,
} from '../lib/preferences';
import { setEntrySourceLabel, setEntrySourceSuffix } from '../lib/setEntrySource';
import {
  inProgressWindow,
  progressWindow,
  timestampPosition,
  type ProgressPeriod,
} from '../lib/progressRange';
import {
  buildPersonalRecords,
  isCompletedResultWorkout,
  isValidResultSet,
  type PersonalRecord,
} from '../lib/workoutResults';
import { formatWorkoutDurationSeconds } from '../lib/workoutLifecycle';
import {
  buildCalendarMonth,
  buildExerciseProgress,
  buildWorkoutDays,
  calculateWeeklyStreaks,
  dateKeyInTimeZone,
  workoutCountForMonth,
  workoutCountForYear,
  type ExerciseProgressPoint,
} from '../lib/progress';
import { BodyMeasurementsSection, type MeasurementDraft } from './BodyMeasurementsSection';
import { StarIcon } from './StarIcon';
import './progress-view.css';

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
export type ProgressSection = 'history' | 'strength' | 'measurements';
const progressSections: ProgressSection[] = ['history', 'strength', 'measurements'];

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
  onShowWorkoutResult,
  initialSection = 'strength',
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
  onShowWorkoutResult?: (workout: LocalWorkout) => void;
  initialSection?: ProgressSection;
}) {
  const { locale, unitSystem } = usePreferences();
  const [section, setSection] = useState<ProgressSection>(initialSection);
  const [period, setPeriod] = useState<ProgressPeriod>(30);
  const screenRef = useRef<HTMLElement | null>(null);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const todayKey = dateKeyInTimeZone(new Date(), timeZone);
  const visibleSets = useMemo(() => sets.filter(isValidResultSet), [sets]);
  const completedWorkouts = useMemo(() => workouts.filter(isCompletedResultWorkout), [workouts]);
  const workoutDays = useMemo(
    () => buildWorkoutDays(completedWorkouts, visibleSets, timeZone),
    [timeZone, visibleSets, completedWorkouts],
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
        ? buildExerciseProgress(selectedExercise.id, completedWorkouts, visibleSets, timeZone).sort(
            (left, right) => Date.parse(left.finishedAt) - Date.parse(right.finishedAt),
          )
        : [],
    [selectedExercise, timeZone, visibleSets, completedWorkouts],
  );
  const window = progressWindow(period, todayKey);
  const periodPoints = strengthPoints.filter((point) => inProgressWindow(point.dateKey, window));
  const previousPoints = strengthPoints.filter((point) =>
    inProgressWindow(point.dateKey, window, true),
  );
  const periodDays = workoutDays.filter((day) => inProgressWindow(day.dateKey, window));
  const previousDays = workoutDays.filter((day) => inProgressWindow(day.dateKey, window, true));
  const periodVolume = periodDays.reduce((sum, day) => sum + day.volumeKg, 0);
  const previousVolume = previousDays.reduce((sum, day) => sum + day.volumeKg, 0);
  const records = useMemo(
    () => buildPersonalRecords(completedWorkouts, visibleSets),
    [completedWorkouts, visibleSets],
  );
  const exerciseRecords = records.filter((record) => record.exerciseId === selectedExercise?.id);
  const [pointSelection, setPointSelection] = useState<{ scope: string; workoutId: string } | null>(
    null,
  );
  const selectionScope = `${selectedExercise?.id ?? ''}:${period}:${section}`;
  const selectedPoint =
    (pointSelection?.scope === selectionScope
      ? periodPoints.find((point) => point.workoutId === pointSelection.workoutId)
      : null) ??
    periodPoints.at(-1) ??
    null;
  const selectPoint = (point: ExerciseProgressPoint) =>
    setPointSelection({ scope: selectionScope, workoutId: point.workoutId });
  const selectedWorkout = completedWorkouts.find(
    (workout) => workout.id === selectedPoint?.workoutId,
  );
  const selectedPointSets = visibleSets
    .filter(
      (set) =>
        set.workoutId === selectedPoint?.workoutId && set.exerciseId === selectedExercise?.id,
    )
    .sort((left, right) => left.position - right.position);
  const hasUnsyncedData = workoutDays.some((day) => day.hasUnsyncedData);

  function resetScroll() {
    screenRef.current?.closest('.app-content')?.scrollTo({ top: 0 });
  }

  function changeSection(next: ProgressSection) {
    setSection(next);
    setPointSelection(null);
    setSummaryTip(null);
    resetScroll();
  }

  useEffect(() => {
    screenRef.current?.closest('.app-content')?.scrollTo({ top: 0 });
  }, []);

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
    <section className="screen progress-screen progress-redesign" ref={screenRef}>
      <p className="eyebrow">{tr(locale, 'Твоё движение', 'Your movement')}</p>
      <h1>{tr(locale, 'Прогресс', 'Progress')}</h1>
      <p className="intro">
        {tr(
          locale,
          'Твои тренировки, сила и изменения тела.',
          'Your workouts, strength and body changes.',
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

      <div
        className="progress-tabs"
        role="tablist"
        aria-label={tr(locale, 'Раздел прогресса', 'Progress section')}
      >
        {progressSections.map((tab, index) => (
          <button
            type="button"
            role="tab"
            id={`progress-tab-${tab}`}
            aria-controls={`progress-panel-${tab}`}
            aria-selected={section === tab}
            tabIndex={section === tab ? 0 : -1}
            key={tab}
            onClick={() => changeSection(tab)}
            onKeyDown={(event) => {
              let next: ProgressSection | undefined;
              if (event.key === 'ArrowRight')
                next = progressSections[(index + 1) % progressSections.length];
              if (event.key === 'ArrowLeft')
                next =
                  progressSections[(index + progressSections.length - 1) % progressSections.length];
              if (event.key === 'Home') next = progressSections[0];
              if (event.key === 'End') next = progressSections.at(-1);
              if (!next) return;
              event.preventDefault();
              changeSection(next);
              document.getElementById(`progress-tab-${next}`)?.focus();
            }}
          >
            {tab === 'history'
              ? tr(locale, 'История', 'History')
              : tab === 'strength'
                ? tr(locale, 'Сила', 'Strength')
                : tr(locale, 'Замеры', 'Measurements')}
          </button>
        ))}
      </div>

      {section === 'history' && (
        <div role="tabpanel" id="progress-panel-history" aria-labelledby="progress-tab-history">
          <section className="progress-section" aria-labelledby="calendar-heading">
            <div className="section-head progress-heading">
              <div>
                <p className="eyebrow">{tr(locale, 'Ритм', 'Rhythm')}</p>
                <h2 id="calendar-heading">
                  {tr(locale, 'Календарь тренировок', 'Workout calendar')}
                </h2>
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
                  {day.workout && (
                    <i>{day.workout.workoutCount > 1 ? day.workout.workoutCount : ''}</i>
                  )}
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
                onShowWorkoutResult={onShowWorkoutResult}
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
        </div>
      )}

      {section === 'strength' && (
        <div role="tabpanel" id="progress-panel-strength" aria-labelledby="progress-tab-strength">
          <section className="progress-section" aria-labelledby="strength-heading">
            <div className="section-head progress-heading">
              <div>
                <p className="eyebrow">{tr(locale, 'Сила', 'Strength')}</p>
                <h2 id="strength-heading">
                  {tr(locale, 'Как растёт твоя сила', 'How your strength changes')}
                </h2>
              </div>
            </div>
            <div
              className="progress-periods"
              aria-label={tr(locale, 'Период графика', 'Chart period')}
            >
              {([30, 90, 'all'] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={period === value}
                  onClick={() => {
                    setPeriod(value);
                    setPointSelection(null);
                    resetScroll();
                  }}
                >
                  {value === 'all'
                    ? tr(locale, 'Всё время', 'All time')
                    : tr(locale, `${value} дней`, `${value} days`)}
                </button>
              ))}
            </div>
            <article className="training-volume-card">
              <span>
                {period === 'all'
                  ? tr(locale, 'Объём всех тренировок', 'All workout volume')
                  : tr(
                      locale,
                      `Объём всех тренировок за ${period} дней`,
                      `All workout volume over ${period} days`,
                    )}
              </span>
              <strong>{formatWeight(periodVolume, locale, unitSystem)}</strong>
              {window.start && (
                <small>
                  {formatDate(window.start, locale)} — {formatDate(window.end, locale)}
                </small>
              )}
              <small>
                {formatWorkoutCount(
                  periodDays.reduce((sum, day) => sum + day.workoutCount, 0),
                  locale,
                )}{' '}
                · {formatVolumeComparison(periodVolume, previousVolume, locale, period)}
              </small>
            </article>
            {trackedExercises.length ? (
              <>
                <div
                  className="muscle-filters"
                  aria-label={tr(locale, 'Группа мышц', 'Muscle group')}
                >
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
                <p className="strength-comparison">
                  {formatStrengthComparison(
                    periodPoints,
                    previousPoints,
                    period,
                    locale,
                    unitSystem,
                  )}
                </p>
                <StrengthChart
                  points={periodPoints}
                  selectedPoint={selectedPoint}
                  onSelect={selectPoint}
                />
                {selectedPoint && selectedWorkout && (
                  <article
                    className="progress-source-card"
                    aria-label={tr(locale, 'Исходные подходы точки', 'Point source sets')}
                  >
                    <div className="progress-source-heading">
                      <div>
                        <span>{tr(locale, 'Исходные подходы', 'Source sets')}</span>
                        <strong>
                          {formatDate(selectedPoint.dateKey, locale)} ·{' '}
                          {formatTime(selectedWorkout.startedAt, locale)}
                        </strong>
                      </div>
                      <span>
                        {selectedPoint.setCount} {tr(locale, 'подх.', 'sets')}
                      </span>
                    </div>
                    <ol className="progress-source-sets">
                      {selectedPointSets.map((set) => (
                        <li key={set.id}>
                          <div>
                            <strong>
                              {formatSourceWeight(set.weightKg, locale, unitSystem)} × {set.reps}
                            </strong>
                            {set.rir !== null && <span>RIR {set.rir}</span>}
                          </div>
                          <small>
                            {setEntrySourceLabel(set.entrySource, locale) ??
                              tr(locale, 'Вручную', 'Manual')}
                            {set.id === selectedPoint.sourceSet.id
                              ? tr(locale, ' · источник 1RM', ' · 1RM source')
                              : ''}
                            {set.weightKg === selectedPoint.topWeightKg
                              ? tr(locale, ' · лучший вес', ' · best weight')
                              : ''}
                          </small>
                          {set.comment && <p>{set.comment}</p>}
                        </li>
                      ))}
                    </ol>
                    <div className="progress-source-actions">
                      {onShowWorkoutResult && (
                        <button
                          className="button primary small"
                          type="button"
                          onClick={() => onShowWorkoutResult(selectedWorkout)}
                        >
                          {tr(locale, 'Итог тренировки', 'Workout summary')}
                        </button>
                      )}
                      <button
                        className="button ghost small"
                        type="button"
                        onClick={() => onEditWorkout(selectedWorkout)}
                      >
                        {tr(locale, 'Открыть тренировку', 'Open workout')}
                      </button>
                    </div>
                  </article>
                )}
                <details className="progress-point-history">
                  <summary>
                    {tr(locale, 'Все тренировки за период', 'All workouts in this period')}{' '}
                    <span>{periodPoints.length}</span>
                  </summary>
                  <div className="strength-history">
                    {[...periodPoints].reverse().map((point) => (
                      <button
                        type="button"
                        key={point.workoutId}
                        aria-pressed={point.workoutId === selectedPoint?.workoutId}
                        onClick={() => {
                          selectPoint(point);
                          screenRef.current
                            ?.querySelector('.progress-source-card')
                            ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        }}
                      >
                        <time dateTime={point.finishedAt}>
                          {formatDate(point.dateKey, locale)} ·{' '}
                          {formatTime(point.finishedAt, locale)}
                        </time>
                        <span>
                          {point.setCount} {tr(locale, 'подх.', 'sets')} ·{' '}
                          {formatWeight(point.topWeightKg, locale, unitSystem)}
                        </span>
                        <strong>
                          {formatWeight(point.estimatedOneRepMaxKg, locale, unitSystem)} 1RM
                        </strong>
                      </button>
                    ))}
                  </div>
                </details>
                <section className="progress-records" aria-labelledby="personal-records-heading">
                  <p className="eyebrow">{tr(locale, 'За всё время', 'All time')}</p>
                  <h3 id="personal-records-heading">
                    {tr(locale, 'Личные рекорды', 'Personal records')}
                  </h3>
                  <p className="progress-records-note">
                    {tr(
                      locale,
                      'Лучшие сохранённые результаты этого упражнения. Первая тренировка задаёт точку отсчёта.',
                      'Best saved results for this exercise. Your first workout establishes a baseline.',
                    )}
                  </p>
                  <div className="progress-record-grid">
                    {exerciseRecords
                      .filter((record) => record.kind !== 'repsAtWeight')
                      .map((record) => (
                        <RecordCard
                          key={record.kind}
                          record={record}
                          timeZone={timeZone}
                          onOpen={() => {
                            const workout = completedWorkouts.find(
                              (item) => item.id === record.workoutId,
                            );
                            if (workout) (onShowWorkoutResult ?? onEditWorkout)(workout);
                          }}
                        />
                      ))}
                  </div>
                  {exerciseRecords.some((record) => record.kind === 'repsAtWeight') && (
                    <details
                      className="progress-rep-records"
                      open={exerciseRecords.every((record) => record.kind === 'repsAtWeight')}
                    >
                      <summary>
                        {tr(locale, 'Больше повторов с тем же весом', 'Most reps at each weight')}
                      </summary>
                      {exerciseRecords
                        .filter((record) => record.kind === 'repsAtWeight')
                        .sort((left, right) => right.sourceSet.weightKg - left.sourceSet.weightKg)
                        .map((record) => (
                          <RecordCard
                            key={record.sourceSet.weightKg}
                            record={record}
                            timeZone={timeZone}
                            onOpen={() => {
                              const workout = completedWorkouts.find(
                                (item) => item.id === record.workoutId,
                              );
                              if (workout) (onShowWorkoutResult ?? onEditWorkout)(workout);
                            }}
                          />
                        ))}
                    </details>
                  )}
                  <p className="progress-formula">
                    {tr(
                      locale,
                      'Epley: вес × (1 + (повторы + RIR) / 30). Расчётный 1RM — ориентир для сравнения, не проверенный максимум. Без RIR используется 0. Для нулевого веса сравнивай повторы.',
                      'Epley: weight × (1 + (reps + RIR) / 30). Estimated 1RM is a comparison aid, not a tested maximum. Missing RIR is treated as 0. For zero load, compare reps.',
                    )}
                  </p>
                </section>
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
        </div>
      )}

      {section === 'measurements' && (
        <div
          role="tabpanel"
          id="progress-panel-measurements"
          aria-labelledby="progress-tab-measurements"
        >
          <BodyMeasurementsSection
            measurements={measurements}
            onDelete={onDeleteMeasurement}
            onImport={onImportMeasurements}
            onSave={onSaveMeasurement}
          />
        </div>
      )}
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
  onShowWorkoutResult,
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
  onShowWorkoutResult?: (workout: LocalWorkout) => void;
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
                {onShowWorkoutResult && (
                  <button
                    className="button ghost small"
                    onClick={() => onShowWorkoutResult(workout)}
                    type="button"
                  >
                    {tr(locale, 'Итог', 'Summary')}
                  </button>
                )}
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
                          `${formatSourceWeight(set.weightKg, locale, unitSystem)}×${set.reps}${set.rir === null ? '' : ` @${set.rir}`}${setEntrySourceSuffix(set.entrySource, locale)}`,
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

function StrengthChart({
  points,
  selectedPoint,
  onSelect,
}: {
  points: ExerciseProgressPoint[];
  selectedPoint: ExerciseProgressPoint | null;
  onSelect: (point: ExerciseProgressPoint) => void;
}) {
  const { locale, unitSystem } = usePreferences();
  if (!points.length)
    return (
      <p className="progress-empty compact">
        {tr(
          locale,
          'За этот период нет подходов. Выбери другой период.',
          'No sets in this period. Choose another period.',
        )}
      </p>
    );
  const first = points[0];
  const last = points.at(-1)!;
  const maximum = Math.max(
    1,
    ...points.flatMap((point) => [point.topWeightKg, point.estimatedOneRepMaxKg]),
  );
  const xFor = (point: ExerciseProgressPoint) =>
    58 + timestampPosition(point.finishedAt, first.finishedAt, last.finishedAt) * 244;
  const yFor = (value: number) => 162 - (value / maximum) * 130;
  const coordinates = (selector: (point: ExerciseProgressPoint) => number) =>
    points.map((point) => `${xFor(point)},${yFor(selector(point))}`).join(' ');
  const selectedIndex = Math.max(
    0,
    points.findIndex((point) => point.workoutId === selectedPoint?.workoutId),
  );
  const selected = points[selectedIndex];
  return (
    <div className="strength-chart interactive-strength-chart">
      <div className="chart-legend">
        <span className="weight">{tr(locale, 'Рабочий вес', 'Working weight')}</span>
        <span className="estimated">{tr(locale, 'Расчётный 1RM', 'Estimated 1RM')}</span>
      </div>
      <p className="chart-touch-hint" id="progress-chart-help">
        {tr(
          locale,
          'Коснись графика — ниже появятся подходы. Стрелки переключают тренировки.',
          'Tap the chart to see sets below. Arrow keys switch workouts.',
        )}
      </p>
      <svg
        aria-label={tr(locale, 'Выбрать тренировку на графике', 'Select workout on chart')}
        aria-describedby="progress-chart-help"
        aria-valuemin={1}
        aria-valuemax={points.length}
        aria-valuenow={selectedIndex + 1}
        aria-valuetext={`${formatDate(selected.dateKey, locale)} ${formatTime(selected.finishedAt, locale)}: ${formatWeight(selected.topWeightKg, locale, unitSystem)}, 1RM ${formatWeight(selected.estimatedOneRepMaxKg, locale, unitSystem)}`}
        role="slider"
        tabIndex={0}
        viewBox="0 0 320 190"
        onKeyDown={(event) => {
          let next = selectedIndex;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown')
            next = Math.max(0, selectedIndex - 1);
          else if (event.key === 'ArrowRight' || event.key === 'ArrowUp')
            next = Math.min(points.length - 1, selectedIndex + 1);
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = points.length - 1;
          else return;
          event.preventDefault();
          onSelect(points[next]);
        }}
        onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - bounds.left) / bounds.width) * 320;
          const point = points.reduce((nearest, item) =>
            Math.abs(xFor(item) - x) < Math.abs(xFor(nearest) - x) ? item : nearest,
          );
          onSelect(point);
        }}
      >
        {[1, 0.5, 0].map((ratio) => (
          <g key={ratio}>
            <line
              className="chart-grid"
              x1="58"
              x2="302"
              y1={yFor(maximum * ratio)}
              y2={yFor(maximum * ratio)}
            />
            <text
              className="chart-axis-label"
              x="51"
              y={yFor(maximum * ratio) + 3}
              textAnchor="end"
            >
              {formatWeight(maximum * ratio, locale, unitSystem)}
            </text>
          </g>
        ))}
        <line
          className="chart-selection-line"
          x1={xFor(selected)}
          x2={xFor(selected)}
          y1="24"
          y2="166"
        />
        <polyline
          className="chart-line estimated"
          points={coordinates((point) => point.estimatedOneRepMaxKg)}
        />
        <polyline
          className="chart-line weight"
          points={coordinates((point) => point.topWeightKg)}
        />
        {points.map((point) => (
          <g key={point.workoutId} data-workout-id={point.workoutId}>
            <circle
              className="chart-point estimated"
              cx={xFor(point)}
              cy={yFor(point.estimatedOneRepMaxKg)}
              r={point.workoutId === selected.workoutId ? 5 : 3}
            />
            <circle
              className="chart-point weight"
              cx={xFor(point)}
              cy={yFor(point.topWeightKg)}
              r={point.workoutId === selected.workoutId ? 5 : 3}
            />
          </g>
        ))}
      </svg>
      <div className="chart-range">
        <span>{formatDate(first.dateKey, locale)}</span>
        <span>{formatDate(last.dateKey, locale)}</span>
      </div>
      <div className="chart-point-controls">
        <button
          type="button"
          aria-label={tr(locale, 'Предыдущая тренировка на графике', 'Previous chart workout')}
          disabled={selectedIndex === 0}
          onClick={() => onSelect(points[selectedIndex - 1])}
        >
          ←
        </button>
        <span aria-live="polite">
          {formatDate(selected.dateKey, locale)} · {formatTime(selected.finishedAt, locale)}
          <small>
            {selectedIndex + 1} / {points.length}
          </small>
        </span>
        <button
          type="button"
          aria-label={tr(locale, 'Следующая тренировка на графике', 'Next chart workout')}
          disabled={selectedIndex === points.length - 1}
          onClick={() => onSelect(points[selectedIndex + 1])}
        >
          →
        </button>
      </div>
    </div>
  );
}

function RecordCard({
  record,
  timeZone,
  onOpen,
}: {
  record: PersonalRecord;
  timeZone: string;
  onOpen: () => void;
}) {
  const { locale, unitSystem } = usePreferences();
  return (
    <button className="progress-record-card" type="button" onClick={onOpen}>
      <span>
        {record.kind === 'weight'
          ? tr(locale, 'Максимальный вес', 'Maximum weight')
          : record.kind === 'estimatedOneRepMax'
            ? tr(locale, 'Расчётный 1RM', 'Estimated 1RM')
            : formatSourceWeight(record.sourceSet.weightKg, locale, unitSystem)}
      </span>
      <strong>
        {record.kind === 'repsAtWeight'
          ? `${record.value} ${tr(locale, 'повт.', 'reps')}`
          : record.kind === 'weight'
            ? formatSourceWeight(record.value, locale, unitSystem)
            : formatWeight(record.value, locale, unitSystem)}
      </strong>
      <small>
        {formatSourceWeight(record.sourceSet.weightKg, locale, unitSystem)} ×{' '}
        {record.sourceSet.reps}
        {record.sourceSet.rir === null ? '' : ` · RIR ${record.sourceSet.rir}`}
      </small>
      <small>
        {formatDate(dateKeyInTimeZone(record.startedAt, timeZone), locale)} ·{' '}
        {new Date(record.startedAt).getFullYear()} →
      </small>
    </button>
  );
}

function formatStrengthComparison(
  points: ExerciseProgressPoint[],
  previousPoints: ExerciseProgressPoint[],
  period: ProgressPeriod,
  locale: 'ru' | 'en',
  unitSystem: 'metric' | 'imperial',
): string {
  if (period === 'all')
    return tr(
      locale,
      'Все сохранённые тренировки упражнения. Расстояние между точками соответствует времени.',
      'All saved workouts for this exercise. Point spacing follows elapsed time.',
    );
  if (!points.length)
    return tr(
      locale,
      'В выбранном периоде ещё нет данных этого упражнения.',
      'No data for this exercise in the selected period.',
    );
  if (!previousPoints.length)
    return tr(
      locale,
      `В предыдущие ${period} дней это упражнение не записывалось — сравнивать пока не с чем.`,
      `No logged sets for this exercise in the previous ${period} days — no comparison yet.`,
    );
  const current = Math.max(...points.map((point) => point.estimatedOneRepMaxKg));
  const previous = Math.max(...previousPoints.map((point) => point.estimatedOneRepMaxKg));
  if (!current && !previous)
    return tr(
      locale,
      'Для подходов без дополнительного веса смотри рекорды повторов ниже.',
      'For sets without added weight, see rep records below.',
    );
  const delta = current - previous;
  const change =
    Math.abs(delta) < 0.05
      ? tr(locale, 'без изменений', 'unchanged')
      : `${delta > 0 ? '+' : '−'}${formatWeight(Math.abs(delta), locale, unitSystem)}`;
  return tr(
    locale,
    `Лучший расчётный 1RM: ${change} к предыдущим ${period} дням.`,
    `Best estimated 1RM: ${change} vs the previous ${period} days.`,
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

function formatVolumeComparison(
  current: number,
  previous: number,
  locale: 'ru' | 'en',
  period: ProgressPeriod,
): string {
  if (period === 'all') return tr(locale, 'вес × повторы', 'weight × reps');
  if (previous === 0)
    return tr(
      locale,
      'Нет объёма в предыдущем периоде для сравнения',
      'No volume in the previous period to compare',
    );
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0)
    return tr(
      locale,
      `без изменений к предыдущим ${period} дням`,
      `unchanged vs the previous ${period} days`,
    );
  const prefix = change > 0 ? '+' : '−';
  return tr(
    locale,
    `${prefix}${Math.abs(change)}% к предыдущим ${period} дням`,
    `${prefix}${Math.abs(change)}% vs the previous ${period} days`,
  );
}
