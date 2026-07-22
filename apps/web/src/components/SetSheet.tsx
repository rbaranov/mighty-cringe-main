import { useEffect, useState } from 'react';

import type { Exercise } from '@mighty-cringe/contracts';

import type { LocalSet } from '../lib/db';
import {
  canonicalWeight,
  displayWeight,
  exerciseName,
  tr,
  usePreferences,
  weightUnit,
} from '../lib/preferences';

type Props = {
  exercise: Exercise | null;
  initial: LocalSet | null;
  onClose: () => void;
  onExplain: () => void;
  onSave: (input: {
    weightKg: number;
    reps: number;
    rir: number | null;
    comment: string | null;
  }) => void;
};

export function SetSheet({ exercise, initial, onClose, onExplain, onSave }: Props) {
  const { locale, unitSystem } = usePreferences();
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [rir, setRir] = useState('');
  const [comment, setComment] = useState('');

  useEffect(() => {
    setWeight(initial ? String(displayWeight(initial.weightKg, unitSystem)) : '');
    setReps(initial ? String(initial.reps) : '');
    setRir(initial?.rir === null || initial?.rir === undefined ? '' : String(initial.rir));
    setComment(initial?.comment ?? '');
  }, [exercise?.id, initial?.id, initial?.updatedAt, unitSystem]);

  useEffect(() => {
    if (!exercise) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [exercise]);

  if (!exercise) return null;

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="sheet set-sheet"
        aria-modal="true"
        aria-label={`${initial ? tr(locale, 'Изменить', 'Edit') : tr(locale, 'Новый', 'New')} ${tr(locale, 'подход', 'set')}: ${exerciseName(exercise, locale)}`}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <p className="eyebrow">
          {initial
            ? tr(locale, 'Изменить подход', 'Edit set')
            : tr(locale, 'Новый подход', 'New set')}
        </p>
        <h2>{exerciseName(exercise, locale)}</h2>
        {!initial && (
          <>
            <button className="button explain-entry full" onClick={onExplain} type="button">
              🎙️✏️ {tr(locale, 'Сказать или написать', 'Speak or type')}
            </button>
            <p className="form-divider">{tr(locale, 'или ввести вручную', 'or enter manually')}</p>
          </>
        )}
        <div className="form-grid">
          <label>
            {tr(locale, 'Вес', 'Weight')}, {weightUnit(unitSystem, locale)}
            <input
              enterKeyHint="next"
              inputMode="decimal"
              min="0"
              onChange={(event) => setWeight(event.target.value)}
              placeholder="40"
              type="number"
              value={weight}
            />
          </label>
          <label>
            {tr(locale, 'Повторы', 'Reps')}
            <input
              enterKeyHint="next"
              inputMode="numeric"
              min="1"
              onChange={(event) => setReps(event.target.value)}
              placeholder="12"
              type="number"
              value={reps}
            />
          </label>
          <label>
            RIR
            <input
              enterKeyHint="next"
              inputMode="numeric"
              min="0"
              onChange={(event) => setRir(event.target.value)}
              placeholder="1"
              type="number"
              value={rir}
            />
          </label>
          <label className="wide">
            {tr(locale, 'Комментарий', 'Comment')}
            <input
              enterKeyHint="done"
              maxLength={1000}
              onChange={(event) => setComment(event.target.value)}
              placeholder={tr(locale, 'Как ощущалось?', 'How did it feel?')}
              value={comment}
            />
          </label>
        </div>
        <div className="set-sheet-actions">
          <button
            className="button primary full"
            disabled={!Number.isFinite(Number(weight)) || Number(reps) < 1}
            onClick={() =>
              onSave({
                weightKg: canonicalWeight(Number(weight), unitSystem),
                reps: Number(reps),
                rir: rir === '' ? null : Number(rir),
                comment: comment.trim() || null,
              })
            }
            type="button"
          >
            {initial
              ? tr(locale, 'Сохранить изменения', 'Save changes')
              : tr(locale, 'Сохранить подход', 'Save set')}
          </button>
          <button className="button ghost full" onClick={onClose} type="button">
            {tr(locale, 'Отмена', 'Cancel')}
          </button>
        </div>
      </section>
    </div>
  );
}
