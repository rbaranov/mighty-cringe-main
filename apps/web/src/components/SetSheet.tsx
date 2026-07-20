import { useState } from 'react';

import type { Exercise } from '@mighty-cringe/contracts';

type Props = {
  exercise: Exercise | null;
  onClose: () => void;
  onSave: (input: {
    weightKg: number;
    reps: number;
    rir: number | null;
    comment: string | null;
  }) => void;
};

export function SetSheet({ exercise, onClose, onSave }: Props) {
  const [weightKg, setWeightKg] = useState('');
  const [reps, setReps] = useState('');
  const [rir, setRir] = useState('');
  const [comment, setComment] = useState('');

  if (!exercise) return null;

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="sheet"
        aria-modal="true"
        aria-label={`Новый подход: ${exercise.nameRu}`}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <p className="eyebrow">Новый подход</p>
        <h2>{exercise.nameRu}</h2>
        <div className="form-grid">
          <label>
            Вес, кг
            <input
              autoFocus
              inputMode="decimal"
              min="0"
              onChange={(event) => setWeightKg(event.target.value)}
              placeholder="40"
              type="number"
              value={weightKg}
            />
          </label>
          <label>
            Повторы
            <input
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
              inputMode="numeric"
              min="0"
              onChange={(event) => setRir(event.target.value)}
              placeholder="1"
              type="number"
              value={rir}
            />
          </label>
          <label className="wide">
            Комментарий
            <input
              maxLength={1000}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Как ощущалось?"
              value={comment}
            />
          </label>
        </div>
        <button
          className="button primary full"
          disabled={!Number.isFinite(Number(weightKg)) || Number(reps) < 1}
          onClick={() =>
            onSave({
              weightKg: Number(weightKg),
              reps: Number(reps),
              rir: rir === '' ? null : Number(rir),
              comment: comment.trim() || null,
            })
          }
          type="button"
        >
          Сохранить подход
        </button>
        <button className="button ghost full" onClick={onClose} type="button">
          Отмена
        </button>
      </section>
    </div>
  );
}
