import { useEffect, useState, type ReactNode } from 'react';

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
import {
  formatNumericInput,
  parseDecimalInput,
  parseIntegerInput,
  stepNumericInput,
} from './setSheetNumbers';

type Props = {
  exercise: Exercise | null;
  initial: LocalSet | null;
  defaults: LocalSet | null;
  onClose: () => void;
  onExplain: () => void;
  onSave: (input: {
    weightKg: number;
    reps: number;
    rir: number | null;
    comment: string | null;
  }) => void;
};

export const setWeightStep = 1;

export function SetSheet({ exercise, initial, defaults, onClose, onExplain, onSave }: Props) {
  const { locale, unitSystem } = usePreferences();
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [rir, setRir] = useState('');
  const [comment, setComment] = useState('');
  const maximumDisplayWeight = displayWeight(1000, unitSystem);
  const weightValue = parseDecimalInput(weight);
  const repsValue = parseIntegerInput(reps);
  const rirValue = rir === '' ? null : parseIntegerInput(rir);
  const canonicalWeightValue =
    weightValue === null ? null : canonicalWeight(weightValue, unitSystem);
  const canSave =
    canonicalWeightValue !== null &&
    canonicalWeightValue >= 0 &&
    canonicalWeightValue <= 1000 &&
    repsValue !== null &&
    repsValue >= 1 &&
    repsValue <= 100 &&
    (rirValue === null || (rirValue >= 0 && rirValue <= 20));

  useEffect(() => {
    const source = initial ?? defaults;
    setWeight(source ? formatNumericInput(displayWeight(source.weightKg, unitSystem), locale) : '');
    setReps(source ? String(source.reps) : '');
    setRir(source?.rir === null || source?.rir === undefined ? '' : String(source.rir));
    setComment(initial?.comment ?? '');
  }, [
    exercise?.id,
    initial?.id,
    initial?.updatedAt,
    defaults?.id,
    defaults?.updatedAt,
    unitSystem,
  ]);

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
          <NumericStepper
            allowDecimal
            decrementDisabled={weightValue !== null && weightValue <= 0}
            incrementDisabled={weightValue !== null && weightValue >= maximumDisplayWeight}
            inputLabel={`${tr(locale, 'Вес', 'Weight')}, ${weightUnit(unitSystem, locale)}`}
            label={
              <>
                {tr(locale, 'Вес', 'Weight')}, {weightUnit(unitSystem, locale)}
              </>
            }
            locale={locale}
            maximum={maximumDisplayWeight}
            minimum={0}
            onChange={setWeight}
            placeholder="40"
            step={setWeightStep}
            value={weight}
          />
          <NumericStepper
            decrementDisabled={repsValue !== null && repsValue <= 1}
            incrementDisabled={repsValue !== null && repsValue >= 100}
            inputLabel={tr(locale, 'Повторы', 'Reps')}
            label={tr(locale, 'Повторы', 'Reps')}
            locale={locale}
            maximum={100}
            minimum={1}
            onChange={setReps}
            placeholder="12"
            step={1}
            value={reps}
          />
          <NumericStepper
            decrementDisabled={rirValue !== null && rirValue <= 0}
            incrementDisabled={rirValue !== null && rirValue >= 20}
            inputLabel="RIR"
            label={
              <>
                RIR
                <span className="rir-help">
                  <button
                    aria-describedby="rir-tooltip"
                    aria-label={tr(locale, 'Что такое RIR?', 'What is RIR?')}
                    type="button"
                  >
                    ?
                  </button>
                  <span id="rir-tooltip" role="tooltip">
                    {tr(
                      locale,
                      'RIR — сколько повторов осталось бы в запасе до отказа. 0 — ни одного, 2 — ещё примерно два.',
                      'RIR means reps left in reserve before failure. 0 means none; 2 means about two more.',
                    )}
                  </span>
                </span>
              </>
            }
            locale={locale}
            maximum={20}
            minimum={0}
            onChange={setRir}
            placeholder="1"
            step={1}
            value={rir}
          />
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
            disabled={!canSave}
            onClick={() => {
              if (!canSave || canonicalWeightValue === null || repsValue === null) return;
              onSave({
                weightKg: canonicalWeightValue,
                reps: repsValue,
                rir: rirValue,
                comment: comment.trim() || null,
              });
            }}
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

function NumericStepper({
  allowDecimal = false,
  decrementDisabled,
  incrementDisabled,
  inputLabel,
  label,
  locale,
  maximum,
  minimum,
  onChange,
  placeholder,
  step,
  value,
}: {
  allowDecimal?: boolean;
  decrementDisabled: boolean;
  incrementDisabled: boolean;
  inputLabel: string;
  label: ReactNode;
  locale: 'ru' | 'en';
  maximum: number;
  minimum: number;
  onChange: (value: string) => void;
  placeholder: string;
  step: number;
  value: string;
}) {
  return (
    <div className="set-stepper-field">
      <div className="set-stepper-label">{label}</div>
      <div className="set-stepper-control">
        <button
          aria-label={tr(locale, `Уменьшить: ${inputLabel}`, `Decrease: ${inputLabel}`)}
          disabled={decrementDisabled}
          onClick={() => onChange(stepNumericInput(value, -1, step, minimum, maximum, locale))}
          type="button"
        >
          −
        </button>
        <input
          aria-label={inputLabel}
          enterKeyHint="next"
          inputMode={allowDecimal ? 'decimal' : 'numeric'}
          onChange={(event) => onChange(event.target.value)}
          pattern={allowDecimal ? '[0-9]*[.,]?[0-9]*' : '[0-9]*'}
          placeholder={placeholder}
          type="text"
          value={value}
        />
        <button
          aria-label={tr(locale, `Увеличить: ${inputLabel}`, `Increase: ${inputLabel}`)}
          disabled={incrementDisabled}
          onClick={() => onChange(stepNumericInput(value, 1, step, minimum, maximum, locale))}
          type="button"
        >
          +
        </button>
      </div>
    </div>
  );
}
