import { useEffect, useState } from 'react';

import {
  exerciseNameIssue,
  muscleGroups,
  type CurrentUser,
  type Exercise,
} from '@mighty-cringe/contracts';

import { createManualExercise } from '../lib/exercises';
import { ExerciseDiscoveryPanel } from './ExerciseDiscoveryPanel';

type Muscle = Exercise['primaryMuscles'][number];

export function ExerciseAddPanel({
  existingExercises,
  hasMatches = false,
  locale,
  onExerciseSaved,
  query,
}: {
  existingExercises: Exercise[];
  hasMatches?: boolean;
  locale: CurrentUser['locale'];
  onExerciseSaved: (exercise: Exercise) => Promise<void>;
  query: string;
}) {
  const online = typeof navigator === 'undefined' || navigator.onLine;
  const [mode, setMode] = useState<'choice' | 'manual' | 'online'>('choice');
  const [name, setName] = useState(query.trim());
  const [muscle, setMuscle] = useState<Muscle | null>(() => inferredMuscle(query));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode('choice');
    setName(query.trim());
    setMuscle(inferredMuscle(query));
    setError(null);
  }, [query]);

  async function saveManualExercise() {
    const canonicalName = name.trim();
    if (!canonicalName || !muscle) {
      setError(
        tr(
          locale,
          'Укажи название и выбери основную мышцу.',
          'Enter a name and choose the primary muscle.',
        ),
      );
      return;
    }
    if (exerciseNameIssue(canonicalName)) {
      setError(
        tr(
          locale,
          'Название слишком общее. Добавь снаряд, положение, угол или хват.',
          'The name is too broad. Add equipment, position, angle, or grip.',
        ),
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const exercise = await createManualExercise({
        name: canonicalName,
        locale,
        primaryMuscle: muscle,
      });
      await onExerciseSaved(exercise);
    } catch {
      setError(
        tr(
          locale,
          'Не удалось сохранить упражнение на устройстве. Попробуй ещё раз.',
          'Could not save the exercise on this device. Try again.',
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  if (mode === 'online') {
    return (
      <div className="exercise-add-panel">
        <button className="exercise-add-back" onClick={() => setMode('choice')} type="button">
          ← {tr(locale, 'К вариантам добавления', 'Back to add options')}
        </button>
        <ExerciseDiscoveryPanel
          autoSearch
          existingExercises={existingExercises}
          initialQuery={query}
          locale={locale}
          onExerciseSaved={onExerciseSaved}
        />
      </div>
    );
  }

  if (mode === 'manual') {
    return (
      <section
        className="exercise-add-panel manual"
        aria-label={tr(locale, 'Создать упражнение', 'Create exercise')}
      >
        <button className="exercise-add-back" onClick={() => setMode('choice')} type="button">
          ← {tr(locale, 'К вариантам добавления', 'Back to add options')}
        </button>
        <strong>{tr(locale, 'Быстро создать своё', 'Quickly create your own')}</strong>
        <p>
          {tr(
            locale,
            'Сохраним на устройстве и сразу дадим использовать. Источники и видео можно добавить позже из карточки.',
            'It will be saved on this device and ready to use. Sources and video can be added later from its details.',
          )}
        </p>
        <label>
          {tr(locale, 'Название или описание движения', 'Name or movement description')}
          <input
            maxLength={80}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            value={name}
          />
        </label>
        <fieldset>
          <legend>{tr(locale, 'Основная мышца', 'Primary muscle')}</legend>
          <div className="manual-muscle-grid">
            {muscleGroups.map((item) => (
              <button
                aria-pressed={muscle === item}
                className={muscle === item ? 'active' : ''}
                key={item}
                onClick={() => {
                  setMuscle(item);
                  setError(null);
                }}
                type="button"
              >
                {muscleName(item, locale)}
              </button>
            ))}
          </div>
        </fieldset>
        {error && (
          <p className="clarification compact" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary full"
          disabled={saving || !name.trim() || !muscle}
          onClick={() => void saveManualExercise()}
          type="button"
        >
          {saving
            ? tr(locale, 'Сохраняю…', 'Saving…')
            : tr(locale, 'Создать и использовать', 'Create and use')}
        </button>
      </section>
    );
  }

  return (
    <section
      className="exercise-add-panel choice"
      aria-label={tr(locale, 'Новое упражнение', 'New exercise')}
    >
      <strong>
        {hasMatches
          ? tr(locale, 'Нужно другое упражнение?', 'Need a different exercise?')
          : tr(locale, 'В каталоге такого упражнения нет', 'This exercise is not in the catalog')}
      </strong>
      <p>
        {tr(
          locale,
          'Создай его сразу или попроси приложение проверить интернет-источники.',
          'Create it now or ask the app to check online sources.',
        )}
      </p>
      <button className="button primary full" onClick={() => setMode('manual')} type="button">
        {tr(locale, `Создать «${query.trim()}»`, `Create “${query.trim()}”`)}
      </button>
      <button
        className="button ghost full"
        disabled={!online}
        onClick={() => setMode('online')}
        type="button"
      >
        {online
          ? tr(locale, 'Найти информацию в интернете', 'Find information online')
          : tr(locale, 'Интернет-поиск недоступен офлайн', 'Online search is unavailable offline')}
      </button>
    </section>
  );
}

export function inferredMuscle(query: string): Muscle | null {
  const value = query.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  const matches: Array<[RegExp, Muscle]> = [
    [/задн[а-я]*\s+дельт|rear[ -]?delt/u, 'rear_delt'],
    [/средн[а-я]*\s+дельт|lateral\s+raise|middle[ -]?delt/u, 'middle_delt'],
    [/передн[а-я]*\s+дельт|front[ -]?delt/u, 'front_delt'],
    [/груд|chest|pec/u, 'chest'],
    [/спин|широчай|back|lat/u, 'back'],
    [/бицепс(?!\s+бед)|biceps/u, 'biceps'],
    [/трицепс|triceps/u, 'triceps'],
    [/квадрицепс|quadriceps|quad/u, 'quadriceps'],
    [/бицепс\s+бед|hamstring/u, 'hamstrings'],
    [/ягод|glute/u, 'glutes'],
    [/приводящ|adductor/u, 'adductors'],
    [/икр|calf|calves/u, 'calves'],
    [/пресс|кор|abs|core/u, 'core'],
  ];
  return matches.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

function muscleName(muscle: Muscle, locale: 'ru' | 'en') {
  const labels: Record<Muscle, [string, string]> = {
    chest: ['Грудь', 'Chest'],
    back: ['Спина', 'Back'],
    front_delt: ['Передняя дельта', 'Front delt'],
    middle_delt: ['Средняя дельта', 'Middle delt'],
    rear_delt: ['Задняя дельта', 'Rear delt'],
    biceps: ['Бицепс', 'Biceps'],
    triceps: ['Трицепс', 'Triceps'],
    quadriceps: ['Квадрицепс', 'Quadriceps'],
    hamstrings: ['Бицепс бедра', 'Hamstrings'],
    glutes: ['Ягодицы', 'Glutes'],
    adductors: ['Приводящие', 'Adductors'],
    calves: ['Икры', 'Calves'],
    core: ['Кор', 'Core'],
  };
  return labels[muscle][locale === 'en' ? 1 : 0];
}

function tr(locale: 'ru' | 'en', ru: string, en: string) {
  return locale === 'en' ? en : ru;
}
