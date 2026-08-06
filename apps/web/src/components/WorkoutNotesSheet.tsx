import { useEffect, useRef, useState } from 'react';

import type { LocalWorkout } from '../lib/db';
import { tr, usePreferences } from '../lib/preferences';
import { workoutNotesMaxLength } from '../lib/workoutNotes';
import { useKeyboardViewport } from './SetSheet';

export function WorkoutNotesSheet({
  onClose,
  onSave,
  workout,
}: {
  onClose: () => void;
  onSave: (workout: LocalWorkout, notes: string) => Promise<void>;
  workout: LocalWorkout | null;
}) {
  const { locale } = usePreferences();
  const [draft, setDraft] = useState(workout?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const viewportStyle = useKeyboardViewport(Boolean(workout), sheetRef);

  useEffect(() => {
    if (!workout) return;
    setDraft(workout.notes ?? '');
    setSaving(false);
  }, [workout?.id, workout?.notes]);

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
  const changed = (draft.trim() || null) !== currentWorkout.notes;

  function save() {
    if (!changed || saving) return;
    setSaving(true);
    void onSave(currentWorkout, draft)
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
        aria-label={tr(locale, 'Комментарий по тренировке', 'Workout note')}
        aria-modal="true"
        className="sheet set-sheet workout-notes-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        ref={sheetRef}
        role="dialog"
      >
        <div className="sheet-handle" />
        <p className="eyebrow">{tr(locale, 'Тренировка', 'Workout')}</p>
        <h2>{tr(locale, 'Комментарий по тренировке', 'Workout note')}</h2>
        <p className="workout-notes-hint">
          {tr(
            locale,
            'Самочувствие, условия и общее впечатление',
            'How you felt, training conditions, and overall context',
          )}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label className="workout-notes-field">
            <span>{tr(locale, 'Комментарий', 'Note')}</span>
            <textarea
              autoFocus
              maxLength={workoutNotesMaxLength}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={tr(
                locale,
                'Например: мало спал, душно, но рабочие веса шли уверенно',
                'For example: slept poorly, the gym was hot, but working sets felt strong',
              )}
              rows={5}
              value={draft}
            />
          </label>
          <small className="workout-notes-counter">
            {draft.length}/{workoutNotesMaxLength}
          </small>
          <div className="sheet-actions">
            <button className="button ghost" disabled={saving} onClick={onClose} type="button">
              {tr(locale, 'Отмена', 'Cancel')}
            </button>
            <button className="button primary" disabled={!changed || saving} type="submit">
              {saving ? tr(locale, 'Сохраняю…', 'Saving…') : tr(locale, 'Сохранить', 'Save')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
