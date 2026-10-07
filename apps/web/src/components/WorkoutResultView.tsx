import { useEffect, useMemo, useRef } from 'react';
import type { Exercise } from '@mighty-cringe/contracts';

import type { LocalSet, LocalWorkout } from '../lib/db';
import { exerciseName, formatSourceWeight, tr, usePreferences } from '../lib/preferences';
import { buildWorkoutResult, type WorkoutAchievement } from '../lib/workoutResults';
import { formatWorkoutDurationSeconds } from '../lib/workoutLifecycle';
import './workout-results.css';

export function WorkoutResultView({
  workout,
  workouts,
  sets,
  exercises,
  onDone,
  onOpenWorkout,
  onProgress,
  onFavorite,
}: {
  workout: LocalWorkout;
  workouts: LocalWorkout[];
  sets: LocalSet[];
  exercises: Exercise[];
  onDone: () => void;
  onOpenWorkout: () => void;
  onProgress: () => void;
  onFavorite: () => void;
}) {
  const { locale, unitSystem } = usePreferences();
  const resultRef = useRef<HTMLElement>(null);
  useEffect(() => {
    resultRef.current?.closest('.app-content')?.scrollTo(0, 0);
  }, [workout.id]);
  const result = useMemo(
    () => buildWorkoutResult(workout, workouts, sets),
    [workout, workouts, sets],
  );
  const names = new Map(exercises.map((exercise) => [exercise.id, exerciseName(exercise, locale)]));
  const weight = (value: number) => formatSourceWeight(value, locale, unitSystem);
  // Pending deletions still need syncing even though they no longer contribute to metrics.
  const localSets = sets.filter((set) => set.workoutId === workout.id);
  const hasConflict =
    workout.syncState === 'conflict' || localSets.some((set) => set.syncState === 'conflict');
  const pending =
    workout.syncState !== 'synced' || localSets.some((set) => set.syncState !== 'synced');
  if (!result) return null;

  function achievementRow(achievement: WorkoutAchievement) {
    const label =
      achievement.kind === 'weight'
        ? tr(locale, 'Новый максимальный вес', 'New heaviest weight')
        : achievement.kind === 'estimatedOneRepMax'
          ? tr(locale, 'Новый расчётный 1RM', 'New estimated 1RM')
          : tr(locale, 'Больше повторов с этим весом', 'Most reps at this weight');
    return (
      <li key={`${achievement.exerciseId}-${achievement.kind}-${achievement.sourceSet.weightKg}`}>
        <span className="result-record-label">{label}</span>
        <strong>{names.get(achievement.exerciseId) ?? tr(locale, 'Упражнение', 'Exercise')}</strong>
        <span className="result-record-value">
          {achievement.kind === 'repsAtWeight'
            ? `${achievement.previousValue} → ${achievement.value} ${tr(locale, 'повт.', 'reps')} · ${weight(achievement.sourceSet.weightKg)}`
            : `${weight(achievement.previousValue)} → ${weight(achievement.value)}`}
        </span>
        <small>
          {tr(locale, 'Исходный подход', 'Source set')}: {weight(achievement.sourceSet.weightKg)} ×{' '}
          {achievement.sourceSet.reps}
          {achievement.sourceSet.rir === null ? '' : ` · RIR ${achievement.sourceSet.rir}`}
        </small>
      </li>
    );
  }

  return (
    <section
      className="screen workout-result"
      ref={resultRef}
      aria-labelledby="workout-result-heading"
    >
      <div className="result-heading">
        <p className="eyebrow">{tr(locale, 'Работа сделана', 'Work done')}</p>
        <h1 id="workout-result-heading">
          {tr(locale, 'Тренировка завершена', 'Workout complete')}
        </h1>
        <p className="subtle">
          {new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(workout.startedAt))}
        </p>
      </div>

      <dl className="result-metrics">
        <div>
          <dt>{tr(locale, 'Время', 'Time')}</dt>
          <dd>{formatWorkoutDurationSeconds(result.durationSeconds, locale)}</dd>
        </div>
        <div>
          <dt>{tr(locale, 'Упражнения', 'Exercises')}</dt>
          <dd>{result.exerciseCount}</dd>
        </div>
        <div>
          <dt>{tr(locale, 'Подходы', 'Sets')}</dt>
          <dd>{result.setCount}</dd>
        </div>
      </dl>

      <p className={`result-save-status${hasConflict ? ' conflict' : ''}`} role="status">
        {hasConflict
          ? tr(
              locale,
              'Сохранено на устройстве · проверь конфликт в настройках.',
              'Saved on this device · review the conflict in settings.',
            )
          : pending
            ? tr(
                locale,
                'Сохранено на устройстве · ожидает синхронизации.',
                'Saved on this device · waiting to sync.',
              )
            : tr(locale, 'Сохранено и синхронизировано.', 'Saved and synced.')}
      </p>

      {result.achievements.length > 0 && (
        <section
          className="result-achievements"
          aria-label={tr(locale, 'Новые рекорды', 'New records')}
        >
          <h2>
            {tr(locale, 'Новые рекорды', 'New records')} <span>{result.achievements.length}</span>
          </h2>
          <ul className="result-records">{result.achievements.slice(0, 3).map(achievementRow)}</ul>
          {result.achievements.length > 3 && (
            <details>
              <summary>
                {tr(locale, 'Все рекорды тренировки', 'All workout records')} ·{' '}
                {result.achievements.length}
              </summary>
              <ul className="result-records">{result.achievements.slice(3).map(achievementRow)}</ul>
            </details>
          )}
          {result.achievements.some((item) => item.kind === 'estimatedOneRepMax') && (
            <p className="result-note">
              {tr(
                locale,
                '1RM — оценка по весу, повторам и RIR, а не проверенный максимальный вес.',
                '1RM is an estimate from weight, reps and RIR, not a tested maximum.',
              )}
            </p>
          )}
        </section>
      )}

      <section className="result-comparison" aria-labelledby="result-comparison-heading">
        <h2 id="result-comparison-heading">
          {tr(locale, 'По сравнению с прошлым разом', 'Compared with last time')}
        </h2>
        {result.setCount === 0 ? (
          <p>
            {tr(
              locale,
              'Подходов пока нет. Тренировка сохранена в истории, но не увеличивает статистику и серию.',
              'No sets yet. The workout is kept in history, but does not increase your stats or streak.',
            )}
          </p>
        ) : (
          <ul className="result-exercises">
            {result.exercises.map((item) => (
              <li key={item.exerciseId}>
                <strong>
                  {names.get(item.exerciseId) ?? tr(locale, 'Упражнение', 'Exercise')}
                </strong>
                {item.previous ? (
                  <>
                    <small>
                      {tr(locale, 'Прошлая тренировка', 'Previous workout')}:{' '}
                      {new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
                        day: 'numeric',
                        month: 'short',
                      }).format(new Date(item.previous.startedAt))}
                    </small>
                    <div className="result-comparison-values">
                      <span>{tr(locale, 'Макс. вес', 'Top weight')}</span>
                      <span>
                        {weight(item.previous.topWeightKg)} → <b>{weight(item.topWeightKg)}</b>
                      </span>
                    </div>
                    {item.repsComparisons
                      .filter((comparison) => comparison.delta !== 0)
                      .map((comparison) => (
                        <div className="result-comparison-values" key={comparison.weightKg}>
                          <span>
                            {tr(locale, 'При', 'At')} {weight(comparison.weightKg)}
                          </span>
                          <span>
                            {comparison.previousReps} →{' '}
                            <b>
                              {comparison.reps} {tr(locale, 'повт.', 'reps')}
                            </b>
                          </span>
                        </div>
                      ))}
                  </>
                ) : (
                  <p className="result-note">
                    {tr(
                      locale,
                      'Первый результат — точка отсчёта для следующих тренировок.',
                      'First result — a baseline for your next workouts.',
                    )}{' '}
                    {weight(item.topWeightKg)} · {item.setCount} {tr(locale, 'подх.', 'sets')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {result.exercises.some((item) => item.previous) && (
          <p className="result-note">
            {tr(
              locale,
              'Сравниваем максимальный вес и лучший подход при одинаковом весе. Для каждого упражнения — своя предыдущая тренировка.',
              'Comparing the heaviest weight and best set at the same weight. Each exercise uses its own previous workout.',
            )}
          </p>
        )}
      </section>

      <div className="result-actions">
        <button className="button primary" onClick={onProgress}>
          {tr(locale, 'Посмотреть прогресс', 'View progress')}
        </button>
        <button className="button ghost" onClick={onOpenWorkout}>
          {tr(locale, 'Открыть тренировку', 'Open workout')}
        </button>
        <button className="button ghost" onClick={onFavorite}>
          {workout.isFavorite
            ? tr(locale, 'Изменить название избранного', 'Rename favorite')
            : tr(locale, 'В избранное', 'Add to favorites')}
        </button>
        <button className="button ghost" onClick={onDone}>
          {tr(locale, 'К плану тренировки', 'Back to workout')}
        </button>
      </div>
    </section>
  );
}
