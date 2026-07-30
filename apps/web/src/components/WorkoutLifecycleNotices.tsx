import type { LocalWorkout } from '../lib/db';
import { tr, usePreferences } from '../lib/preferences';
import { formatWorkoutDurationSeconds, type WorkoutInactivityState } from '../lib/workoutLifecycle';

export function WorkoutInactivityBanner({
  state,
  onContinue,
  onFinish,
}: {
  state: WorkoutInactivityState;
  onContinue: () => void;
  onFinish: () => void;
}) {
  const { locale } = usePreferences();
  if (state.phase !== 'warning') return null;
  return (
    <div className="workout-inactivity-warning" role="status">
      <div>
        <strong>{tr(locale, 'Ещё тренируешься?', 'Still working out?')}</strong>
        <span>
          {tr(locale, 'Автозавершение через', 'Auto-finish in')}{' '}
          {formatCountdown(state.remainingSeconds)}
        </span>
      </div>
      <div>
        <button className="button primary small" onClick={onContinue} type="button">
          {tr(locale, 'Да, продолжаю', 'Yes, keep going')}
        </button>
        <button className="button ghost small" onClick={onFinish} type="button">
          {tr(locale, 'Завершить сейчас', 'Finish now')}
        </button>
      </div>
    </div>
  );
}

export function AutoFinishNotice({
  workout,
  setCount,
  onContinue,
  onDismiss,
  onEdit,
}: {
  workout: LocalWorkout;
  setCount: number;
  onContinue: () => void;
  onDismiss: () => void;
  onEdit: () => void;
}) {
  const { locale } = usePreferences();
  return (
    <div className="auto-finish-notice" role="status">
      <div className="auto-finish-notice-copy">
        <p className="eyebrow">
          {tr(locale, 'Тренировка завершена автоматически', 'Workout finished automatically')}
        </p>
        <strong>
          {new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(workout.startedAt))}
        </strong>
        <span>
          {formatWorkoutDurationSeconds(workout.durationSeconds, locale)} ·{' '}
          {formatSetCount(setCount, locale)}
        </span>
      </div>
      <div className="auto-finish-notice-actions">
        <button className="button primary small" onClick={onContinue} type="button">
          {tr(locale, 'Продолжить', 'Continue')}
        </button>
        <button className="button ghost small" onClick={onEdit} type="button">
          {tr(locale, 'Исправить', 'Edit')}
        </button>
        <button
          aria-label={tr(locale, 'Скрыть уведомление', 'Dismiss notice')}
          className="auto-finish-dismiss"
          onClick={onDismiss}
          type="button"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatSetCount(value: number, locale: 'ru' | 'en') {
  if (locale === 'en') return `${value} ${value === 1 ? 'set' : 'sets'}`;
  const mod100 = value % 100;
  const mod10 = value % 10;
  const noun =
    mod100 >= 11 && mod100 <= 14
      ? 'подходов'
      : mod10 === 1
        ? 'подход'
        : mod10 >= 2 && mod10 <= 4
          ? 'подхода'
          : 'подходов';
  return `${value} ${noun}`;
}
