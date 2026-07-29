import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';

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
  onDelete: (() => void) | null;
  onExplain: () => void;
  onSave: (input: {
    weightKg: number;
    reps: number;
    rir: number | null;
    comment: string | null;
  }) => void | Promise<void>;
};

export const setWeightStep = 1;

export function SetSheet({
  exercise,
  initial,
  defaults,
  onClose,
  onDelete,
  onExplain,
  onSave,
}: Props) {
  const { locale, unitSystem } = usePreferences();
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [rir, setRir] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const weightRef = useRef<HTMLInputElement>(null);
  const repsRef = useRef<HTMLInputElement>(null);
  const rirRef = useRef<HTMLInputElement>(null);
  const commentRef = useRef<HTMLInputElement>(null);
  const viewportStyle = useKeyboardViewport(Boolean(exercise), sheetRef);
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
    setSaving(false);
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

  function save() {
    if (saving || !canSave || canonicalWeightValue === null || repsValue === null) return;
    setSaving(true);
    void Promise.resolve(
      onSave({
        weightKg: canonicalWeightValue,
        reps: repsValue,
        rir: rirValue,
        comment: comment.trim() || null,
      }),
    ).catch(() => setSaving(false));
  }

  return (
    <div
      className="sheet-backdrop keyboard-aware-sheet-backdrop"
      role="presentation"
      style={viewportStyle}
      onMouseDown={onClose}
    >
      <section
        ref={sheetRef}
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
            onEnter={() => focusAndReveal(repsRef)}
            placeholder="40"
            inputRef={weightRef}
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
            onEnter={() => focusAndReveal(rirRef)}
            placeholder="12"
            inputRef={repsRef}
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
            onEnter={() => focusAndReveal(commentRef)}
            placeholder="1"
            inputRef={rirRef}
            step={1}
            value={rir}
          />
          <label className="wide">
            {tr(locale, 'Комментарий', 'Comment')}
            <input
              enterKeyHint="done"
              maxLength={1000}
              onChange={(event) => setComment(event.target.value)}
              onFocus={(event) => revealInput(event.currentTarget)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                save();
              }}
              placeholder={tr(locale, 'Как ощущалось?', 'How did it feel?')}
              ref={commentRef}
              value={comment}
            />
          </label>
        </div>
        <div className="set-sheet-actions">
          <button
            className="button primary full"
            disabled={!canSave || saving}
            onClick={save}
            type="button"
          >
            {saving
              ? tr(locale, 'Сохраняю…', 'Saving…')
              : initial
                ? tr(locale, 'Сохранить изменения', 'Save changes')
                : tr(locale, 'Сохранить подход', 'Save set')}
          </button>
          {initial && onDelete && (
            <button
              className="button danger full"
              disabled={saving}
              onClick={onDelete}
              type="button"
            >
              {tr(locale, 'Удалить подход', 'Delete set')}
            </button>
          )}
          <button className="button ghost full" disabled={saving} onClick={onClose} type="button">
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
  onEnter,
  placeholder,
  inputRef,
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
  onEnter: () => void;
  placeholder: string;
  inputRef: Ref<HTMLInputElement>;
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
          onFocus={(event) => revealInput(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            onEnter();
          }}
          pattern={allowDecimal ? '[0-9]*[.,]?[0-9]*' : '[0-9]*'}
          placeholder={placeholder}
          ref={inputRef}
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

function focusAndReveal(ref: RefObject<HTMLInputElement | null>) {
  const input = ref.current;
  if (!input) return;
  input.focus({ preventScroll: true });
  revealInput(input);
}

function revealInput(input: HTMLElement) {
  window.requestAnimationFrame(() => {
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

function useKeyboardViewport(
  active: boolean,
  sheetRef: RefObject<HTMLElement | null>,
): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();

  useEffect(() => {
    if (!active || !window.visualViewport) {
      setStyle(undefined);
      return;
    }
    const viewport = window.visualViewport;
    const sync = () => {
      setStyle({
        top: `${viewport.offsetTop}px`,
        bottom: 'auto',
        height: `${viewport.height}px`,
      });
      window.requestAnimationFrame(() => {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && sheetRef.current?.contains(focused)) {
          focused.scrollIntoView({ block: 'center' });
        }
      });
    };
    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    return () => {
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
    };
  }, [active, sheetRef]);

  return style;
}
