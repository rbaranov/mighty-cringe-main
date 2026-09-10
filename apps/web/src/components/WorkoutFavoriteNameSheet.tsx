import { useEffect, useRef, useState } from 'react';

import type { LocalWorkout } from '../lib/db';
import {
  normalizeWorkoutFavoriteName,
  workoutFavoriteNameMaxLength,
} from '../lib/workoutFavorites';
import { tr, usePreferences } from '../lib/preferences';
import { useKeyboardViewport } from './SetSheet';

export function WorkoutFavoriteNameSheet({
  onClose,
  onSave,
  workout,
}: {
  onClose: () => void;
  onSave: (workout: LocalWorkout, favoriteName: string | null) => Promise<void>;
  workout: LocalWorkout | null;
}) {
  const { locale } = usePreferences();
  const [draft, setDraft] = useState(workout?.favoriteName ?? '');
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const viewportStyle = useKeyboardViewport(Boolean(workout), sheetRef);

  useEffect(() => {
    if (!workout) return;
    setDraft(workout.favoriteName ?? '');
    setSaving(false);
  }, [workout?.id, workout?.favoriteName]);

  useEffect(() => {
    if (!workout) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [workout]);

  if (!workout) return null;

  const currentWorkout = workout;
  const normalized = normalizeWorkoutFavoriteName(draft);
  const adding = !currentWorkout.isFavorite;
  const changed = adding || normalized !== currentWorkout.favoriteName;

  function save() {
    if (!changed || saving) return;
    setSaving(true);
    void onSave(currentWorkout, normalized)
      .then(onClose)
      .catch(() => setSaving(false));
  }

  return (
    <div
      className="sheet-backdrop keyboard-aware-sheet-backdrop"
      onMouseDown={onClose}
      role="presentation"
      style={viewportStyle}
    >
      <section
        aria-label={tr(
          locale,
          adding ? 'Добавить тренировку в избранное' : 'Изменить название избранной тренировки',
          adding ? 'Add workout to favorites' : 'Edit favorite workout name',
        )}
        aria-modal="true"
        className="sheet set-sheet workout-favorite-name-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        ref={sheetRef}
        role="dialog"
      >
        <div className="sheet-handle" />
        <p className="eyebrow">{tr(locale, 'Избранная тренировка', 'Favorite workout')}</p>
        <h2>
          {tr(
            locale,
            adding ? 'Назови тренировку' : 'Измени название',
            adding ? 'Name it' : 'Edit name',
          )}
        </h2>
        <p className="workout-favorite-name-hint">
          {tr(
            locale,
            'Название необязательно. Без него тренировка останется подписана датой.',
            'A name is optional. Without one, the workout will keep its date label.',
          )}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label className="workout-favorite-name-field">
            <span>{tr(locale, 'Название', 'Name')}</span>
            <input
              autoFocus
              enterKeyHint="done"
              maxLength={workoutFavoriteNameMaxLength}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={tr(locale, 'Например: Тяжёлая грудь', 'For example: Heavy chest')}
              type="text"
              value={draft}
            />
          </label>
          <small className="workout-favorite-name-counter">
            {draft.length}/{workoutFavoriteNameMaxLength}
          </small>
          <div className="sheet-actions">
            <button className="button ghost" disabled={saving} onClick={onClose} type="button">
              {tr(locale, 'Отмена', 'Cancel')}
            </button>
            <button className="button primary" disabled={!changed || saving} type="submit">
              {saving
                ? tr(locale, 'Сохраняю…', 'Saving…')
                : tr(locale, adding ? 'В избранное' : 'Сохранить', adding ? 'Add' : 'Save')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
