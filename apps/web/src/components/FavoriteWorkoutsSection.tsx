import { useState } from 'react';

import type { Exercise } from '@mighty-cringe/contracts';

import type { LocalWorkout } from '../lib/db';
import { exerciseName, formatExerciseCount, tr, usePreferences } from '../lib/preferences';

const collapsedWorkoutCount = 2;

export function FavoriteWorkoutsSection({
  exercises,
  onRemove,
  onRename,
  onRepeat,
  workouts,
}: {
  exercises: Exercise[];
  onRemove: (workout: LocalWorkout) => void;
  onRename: (workout: LocalWorkout) => void;
  onRepeat: (workout: LocalWorkout) => void;
  workouts: LocalWorkout[];
}) {
  const { locale } = usePreferences();
  const [expanded, setExpanded] = useState(false);
  if (!workouts.length) return null;

  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const visibleWorkouts = expanded ? workouts : workouts.slice(0, collapsedWorkoutCount);

  return (
    <section aria-labelledby="favorite-workouts-heading" className="favorite-workouts">
      <div className="section-head">
        <div>
          <p className="eyebrow">{tr(locale, 'Быстрый повтор', 'Quick repeat')}</p>
          <h2 id="favorite-workouts-heading">
            {tr(locale, 'Избранные тренировки', 'Favorite workouts')}
          </h2>
        </div>
        <span>{workouts.length}</span>
      </div>
      <div className="favorite-workout-list">
        {visibleWorkouts.map((workout) => {
          const names = [...workout.exercises]
            .sort((left, right) => left.position - right.position)
            .flatMap((item) => {
              const exercise = exerciseById.get(item.exerciseId);
              return exercise ? [exerciseName(exercise, locale)] : [];
            });
          const previewNames = names.slice(0, 2);
          const hiddenExerciseCount = names.length - previewNames.length;
          const summary = previewNames.length
            ? `${previewNames.join(' · ')}${
                hiddenExerciseCount > 0
                  ? tr(locale, ` · ещё ${hiddenExerciseCount}`, ` · ${hiddenExerciseCount} more`)
                  : ''
              }`
            : tr(locale, 'Пустая тренировка', 'Empty workout');
          const date = formatWorkoutDate(workout.startedAt, locale);
          return (
            <article className="favorite-workout-card" key={workout.id}>
              <div className="favorite-workout-card-copy">
                <div className="favorite-workout-card-meta">
                  <strong>{workout.favoriteName ?? date}</strong>
                  <span>
                    {workout.favoriteName ? `${date} · ` : ''}
                    {formatExerciseCount(names.length, locale)}
                  </span>
                </div>
                <p title={summary}>{summary}</p>
              </div>
              <div className="favorite-workout-card-actions">
                <button
                  className="button ghost small favorite-workout-repeat"
                  onClick={() => onRepeat(workout)}
                  type="button"
                >
                  {tr(locale, 'Повторить', 'Repeat')}
                </button>
                <details className="favorite-workout-actions-menu">
                  <summary
                    aria-label={tr(
                      locale,
                      'Действия с избранной тренировкой',
                      'Favorite workout actions',
                    )}
                    aria-haspopup="true"
                    role="button"
                  >
                    •••
                  </summary>
                  <div>
                    <button
                      onClick={(event) => {
                        event.currentTarget.closest('details')?.removeAttribute('open');
                        onRename(workout);
                      }}
                      type="button"
                    >
                      {tr(locale, 'Изменить название', 'Rename')}
                    </button>
                    <button
                      className="danger-text"
                      onClick={(event) => {
                        event.currentTarget.closest('details')?.removeAttribute('open');
                        onRemove(workout);
                      }}
                      type="button"
                    >
                      {tr(locale, 'Убрать из избранного', 'Remove from favorites')}
                    </button>
                  </div>
                </details>
              </div>
            </article>
          );
        })}
      </div>
      {workouts.length > collapsedWorkoutCount && (
        <button
          aria-expanded={expanded}
          className="button ghost full favorite-workout-list-toggle"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? tr(locale, 'Свернуть', 'Show less') : tr(locale, 'Показать все', 'Show all')}
        </button>
      )}
    </section>
  );
}

function formatWorkoutDate(value: string, locale: 'ru' | 'en') {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}
