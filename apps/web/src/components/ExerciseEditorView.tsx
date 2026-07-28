import { useEffect, useState } from 'react';

import {
  exerciseNameIssue,
  exerciseTags,
  muscleGroups,
  type Exercise,
  type UpdateExerciseInput,
} from '@mighty-cringe/contracts';

import { updatePersonalExercise } from '../lib/exercises';
import { tr, usePreferences } from '../lib/preferences';

type Muscle = Exercise['primaryMuscles'][number];

const muscleNames: Record<'ru' | 'en', Record<Muscle, string>> = {
  ru: {
    chest: 'Грудь',
    back: 'Спина',
    front_delt: 'Передняя дельта',
    middle_delt: 'Средняя дельта',
    rear_delt: 'Задняя дельта',
    biceps: 'Бицепс',
    triceps: 'Трицепс',
    quadriceps: 'Квадрицепс',
    hamstrings: 'Бицепс бедра',
    glutes: 'Ягодицы',
    adductors: 'Приводящие мышцы',
    calves: 'Икры',
    core: 'Кор',
  },
  en: {
    chest: 'Chest',
    back: 'Back',
    front_delt: 'Front delt',
    middle_delt: 'Middle delt',
    rear_delt: 'Rear delt',
    biceps: 'Biceps',
    triceps: 'Triceps',
    quadriceps: 'Quadriceps',
    hamstrings: 'Hamstrings',
    glutes: 'Glutes',
    adductors: 'Adductors',
    calves: 'Calves',
    core: 'Core',
  },
};

export function ExerciseEditorView({
  exercise,
  onClose,
  onSaved,
}: {
  exercise: Exercise | null;
  onClose: () => void;
  onSaved: (exercise: Exercise) => Promise<void>;
}) {
  const { locale } = usePreferences();
  const [draft, setDraft] = useState<UpdateExerciseInput | null>(null);
  const [aliases, setAliases] = useState('');
  const [equipment, setEquipment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!exercise) {
      setDraft(null);
      return;
    }
    setDraft({
      nameRu: exercise.nameRu,
      nameEn: exercise.nameEn,
      aliases: exercise.aliases,
      tag: exercise.tag,
      primaryMuscles: exercise.primaryMuscles,
      secondaryMuscles: exercise.secondaryMuscles,
      equipment: exercise.equipment,
      videos: exercise.videos ?? [],
      sources: exercise.sources ?? [],
      notes: exercise.notes ?? null,
    });
    setAliases(exercise.aliases.join(', '));
    setEquipment(exercise.equipment.join(', '));
    setError(null);
  }, [exercise]);

  if (!exercise || !draft) return null;

  function toggleMuscle(kind: 'primaryMuscles' | 'secondaryMuscles', muscle: Muscle) {
    setDraft((current) => {
      if (!current) return current;
      const selected = current[kind];
      const removing = selected.includes(muscle);
      if (kind === 'primaryMuscles' && removing && selected.length === 1) return current;
      if (!removing && selected.length >= (kind === 'primaryMuscles' ? 4 : 6)) return current;
      return {
        ...current,
        [kind]: removing
          ? selected.filter((candidate) => candidate !== muscle)
          : [...selected, muscle],
      };
    });
  }

  async function save() {
    if (!exercise || !draft) return;
    const current = draft;
    const next: UpdateExerciseInput = {
      ...current,
      nameRu: current.nameRu.trim(),
      nameEn: current.nameEn.trim(),
      aliases: splitList(aliases, 20),
      equipment: splitList(equipment, 10),
      notes: current.notes?.trim() || null,
    };
    if (!next.nameRu || !next.nameEn || !next.primaryMuscles.length) {
      setError(
        tr(
          locale,
          'Заполни названия и выбери хотя бы одну основную мышцу.',
          'Enter both names and choose at least one primary muscle.',
        ),
      );
      return;
    }
    if (exerciseNameIssue(next.nameRu) || exerciseNameIssue(next.nameEn)) {
      setError(
        tr(
          locale,
          'Название слишком общее. Укажи движение и отличительный признак: снаряд, положение, угол или хват. Короткий вариант добавь в синонимы.',
          'The name is too broad. Include the movement and a distinguishing detail: equipment, position, angle or grip. Put the short form in aliases.',
        ),
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updatePersonalExercise(exercise.id, next);
      await onSaved(updated);
      onClose();
    } catch {
      setError(
        tr(
          locale,
          'Не удалось сохранить исправления. Проверь подключение и попробуй ещё раз.',
          'Could not save the corrections. Check your connection and try again.',
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-label={tr(locale, 'Исправить упражнение', 'Edit exercise')}
      className="screen exercise-editor-screen"
    >
      <button className="detail-back" disabled={saving} onClick={onClose} type="button">
        ← {tr(locale, 'К упражнению', 'Back to exercise')}
      </button>
      <p className="eyebrow">{tr(locale, 'Личный каталог', 'Personal catalog')}</p>
      <h1>{tr(locale, 'Исправить данные', 'Edit details')}</h1>
      <p className="intro exercise-editor-intro">
        {tr(
          locale,
          'Исправь карточку личного упражнения. Изменения сохранят историю тренировок.',
          'Correct your personal exercise. The changes keep your workout history intact.',
        )}
      </p>

      <div className="exercise-editor-card">
        <div className="exercise-editor-fields">
          <label>
            {tr(locale, 'Название на русском', 'Russian name')}
            <input
              maxLength={80}
              onChange={(event) => setDraft({ ...draft, nameRu: event.target.value })}
              value={draft.nameRu}
            />
          </label>
          <label>
            {tr(locale, 'Название на английском', 'English name')}
            <input
              maxLength={80}
              onChange={(event) => setDraft({ ...draft, nameEn: event.target.value })}
              value={draft.nameEn}
            />
          </label>
          <p className="field-hint">
            {tr(
              locale,
              'Одно короткое, но однозначное название. Разговорные варианты — в синонимы.',
              'Use one concise, unambiguous name. Put gym shorthand in aliases.',
            )}
          </p>
          <label>
            {tr(locale, 'Синонимы через запятую', 'Aliases, comma-separated')}
            <input
              maxLength={1_000}
              onChange={(event) => setAliases(event.target.value)}
              value={aliases}
            />
          </label>
          <label>
            {tr(locale, 'Оборудование через запятую', 'Equipment, comma-separated')}
            <input
              maxLength={1_000}
              onChange={(event) => setEquipment(event.target.value)}
              value={equipment}
            />
          </label>
        </div>

        <fieldset className="editor-choice-group">
          <legend>{tr(locale, 'Характер', 'Tag')}</legend>
          <div className="segmented-control">
            {exerciseTags.map((tag) => (
              <button
                aria-pressed={draft.tag === tag}
                className={draft.tag === tag ? 'active' : ''}
                key={tag}
                onClick={() => setDraft({ ...draft, tag })}
                type="button"
              >
                {tag === 'mighty' ? '⚡ Mighty' : tag === 'cringe' ? '😬 Cringe' : '• Normal'}
              </button>
            ))}
          </div>
        </fieldset>

        <MuscleChoices
          label={tr(locale, 'Основные мышцы', 'Primary muscles')}
          locale={locale}
          onToggle={(muscle) => toggleMuscle('primaryMuscles', muscle)}
          selected={draft.primaryMuscles}
        />
        <MuscleChoices
          label={tr(locale, 'Дополнительные мышцы', 'Secondary muscles')}
          locale={locale}
          onToggle={(muscle) => toggleMuscle('secondaryMuscles', muscle)}
          selected={draft.secondaryMuscles}
        />

        <label className="exercise-editor-notes">
          {tr(locale, 'Заметка о технике', 'Technique note')}
          <textarea
            maxLength={2_000}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            rows={4}
            value={draft.notes ?? ''}
          />
        </label>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <div className="sheet-actions">
          <button className="button ghost" disabled={saving} onClick={onClose} type="button">
            {tr(locale, 'Отмена', 'Cancel')}
          </button>
          <button
            className="button primary"
            disabled={saving}
            onClick={() => void save()}
            type="button"
          >
            {saving ? tr(locale, 'Сохраняю…', 'Saving…') : tr(locale, 'Сохранить', 'Save')}
          </button>
        </div>
      </div>
    </section>
  );
}

function MuscleChoices({
  label,
  locale,
  onToggle,
  selected,
}: {
  label: string;
  locale: 'ru' | 'en';
  onToggle: (muscle: Muscle) => void;
  selected: Muscle[];
}) {
  return (
    <fieldset className="editor-choice-group">
      <legend>{label}</legend>
      <div className="muscle-choice-grid">
        {muscleGroups.map((muscle) => (
          <button
            aria-pressed={selected.includes(muscle)}
            className={selected.includes(muscle) ? 'active' : ''}
            key={muscle}
            onClick={() => onToggle(muscle)}
            type="button"
          >
            {muscleNames[locale][muscle]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function splitList(value: string, maximum: number) {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, maximum);
}
