import type { Exercise } from '@mighty-cringe/contracts';

import type { LocalWorkout } from '../lib/db';
import { exerciseName, tr, usePreferences } from '../lib/preferences';
import { StarIcon } from './StarIcon';

export function FavoriteWorkoutsSection({
  exercises,
  onRemove,
  onRepeat,
  workouts,
}: {
  exercises: Exercise[];
  onRemove: (workout: LocalWorkout) => void;
  onRepeat: (workout: LocalWorkout) => void;
  workouts: LocalWorkout[];
}) {
  const { locale } = usePreferences();
  if (!workouts.length) return null;

  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));

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
        {workouts.map((workout) => {
          const names = [...workout.exercises]
            .sort((left, right) => left.position - right.position)
            .flatMap((item) => {
              const exercise = exerciseById.get(item.exerciseId);
              return exercise ? [exerciseName(exercise, locale)] : [];
            });
          const summary = names.length
            ? names.join(' · ')
            : tr(locale, 'Пустая тренировка', 'Empty workout');
          return (
            <article className="favorite-workout-card" key={workout.id}>
              <div className="favorite-workout-card-copy">
                <div className="favorite-workout-card-meta">
                  <strong>{formatWorkoutDate(workout.startedAt, locale)}</strong>
                  <span>
                    {tr(locale, `${names.length} упражнений`, `${names.length} exercises`)}
                  </span>
                </div>
                <p title={summary}>{summary}</p>
              </div>
              <button
                className="button primary small favorite-workout-repeat"
                onClick={() => onRepeat(workout)}
                type="button"
              >
                {tr(locale, 'Повторить', 'Repeat')}
              </button>
              <button
                aria-label={tr(
                  locale,
                  'Убрать тренировку из избранного',
                  'Remove workout from favorites',
                )}
                className="favorite-toggle active"
                onClick={() => onRemove(workout)}
                type="button"
              >
                <StarIcon filled />
              </button>
            </article>
          );
        })}
      </div>
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
