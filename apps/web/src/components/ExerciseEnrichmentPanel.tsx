import { useMemo, useState } from 'react';

import type {
  Exercise,
  ExerciseDiscoveryCandidate,
  UpdateExerciseInput,
} from '@mighty-cringe/contracts';

import { db } from '../lib/db';
import { updatePersonalExercise } from '../lib/exercises';
import { exerciseName, tr, usePreferences } from '../lib/preferences';
import { ExerciseDiscoveryPanel } from './ExerciseDiscoveryPanel';

export function ExerciseEnrichmentPanel({
  exercise,
  onClose,
}: {
  exercise: Exercise;
  onClose: () => void;
}) {
  const { locale } = usePreferences();
  const [candidate, setCandidate] = useState<ExerciseDiscoveryCandidate | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const merged = useMemo(
    () => (candidate ? mergeExerciseDetails(exercise, candidate) : null),
    [candidate, exercise],
  );
  const changes = useMemo(
    () => (merged ? enrichmentChanges(exercise, merged, locale) : []),
    [exercise, locale, merged],
  );

  async function applyCandidate() {
    if (!merged || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updatePersonalExercise(exercise.id, merged);
      await db.exercises.put({ ...updated, syncState: 'synced' });
      onClose();
    } catch {
      setError(
        tr(
          locale,
          'Не удалось заполнить карточку. Найденные данные остались на экране — попробуй ещё раз.',
          'Could not fill the details. The found data is still here — try again.',
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="exercise-enrichment"
      aria-label={tr(locale, 'Дополнить упражнение', 'Enrich exercise')}
    >
      <div className="exercise-enrichment-head">
        <div>
          <strong>{tr(locale, 'Заполнить из интернета', 'Fill from the internet')}</strong>
          <p>
            {tr(
              locale,
              'Найду названия, мышцы, оборудование, источники и видео. Существующие данные не изменятся без подтверждения.',
              'Find names, muscles, equipment, sources, and video. Existing details will not change without confirmation.',
            )}
          </p>
        </div>
        <button onClick={onClose} type="button">
          {tr(locale, 'Закрыть', 'Close')}
        </button>
      </div>

      {!candidate ? (
        <ExerciseDiscoveryPanel
          autoSearch
          exerciseId={exercise.id}
          initialQuery={exerciseName(exercise, locale)}
          locale={locale}
          onCandidateSelected={async (selected) => setCandidate(selected)}
        />
      ) : (
        <div className="exercise-enrichment-preview">
          <strong>{tr(locale, 'Что будет заполнено', 'What will be filled')}</strong>
          <dl>
            {changes.map((change) => (
              <div key={change.label}>
                <dt>{change.label}</dt>
                <dd>{change.value}</dd>
              </div>
            ))}
          </dl>
          {changes.length === 0 && (
            <p>
              {tr(
                locale,
                'Новых сведений для этой карточки не найдено.',
                'No new details were found for this exercise.',
              )}
            </p>
          )}
          {error && (
            <p className="clarification compact" role="alert">
              {error}
            </p>
          )}
          <div className="exercise-enrichment-actions">
            <button className="button ghost" onClick={() => setCandidate(null)} type="button">
              {tr(locale, 'Выбрать другой вариант', 'Choose another result')}
            </button>
            <button
              className="button primary"
              disabled={saving || changes.length === 0}
              onClick={() => void applyCandidate()}
              type="button"
            >
              {saving
                ? tr(locale, 'Заполняю…', 'Filling…')
                : tr(locale, 'Заполнить карточку', 'Fill exercise details')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function mergeExerciseDetails(
  exercise: Exercise,
  candidate: ExerciseDiscoveryCandidate,
): UpdateExerciseInput {
  const placeholderTranslation = normalize(exercise.nameRu) === normalize(exercise.nameEn);
  const primaryMuscles = unique([...exercise.primaryMuscles, ...candidate.primaryMuscles]).slice(
    0,
    4,
  );
  return {
    nameRu: placeholderTranslation ? candidate.nameRu : exercise.nameRu,
    nameEn: placeholderTranslation ? candidate.nameEn : exercise.nameEn,
    aliases: unique([...exercise.aliases, ...candidate.aliases]).slice(0, 20),
    tag: exercise.tag,
    primaryMuscles,
    secondaryMuscles: unique([...exercise.secondaryMuscles, ...candidate.secondaryMuscles])
      .filter((muscle) => !primaryMuscles.includes(muscle))
      .slice(0, 6),
    equipment: unique([...exercise.equipment, ...candidate.equipment]).slice(0, 10),
    videos: uniqueLinks([...(exercise.videos ?? []), ...candidate.videos]).slice(0, 5),
    sources: uniqueLinks([...(exercise.sources ?? []), ...candidate.sources]).slice(0, 8),
    notes: exercise.notes?.trim() || candidate.notes,
  };
}

function enrichmentChanges(exercise: Exercise, merged: UpdateExerciseInput, locale: 'ru' | 'en') {
  const changes: Array<{ label: string; value: string }> = [];
  if (merged.nameRu !== exercise.nameRu) {
    changes.push({ label: tr(locale, 'Название RU', 'Russian name'), value: merged.nameRu });
  }
  if (merged.nameEn !== exercise.nameEn) changes.push({ label: 'Name EN', value: merged.nameEn });
  appendArrayChange(changes, tr(locale, 'Синонимы', 'Aliases'), exercise.aliases, merged.aliases);
  appendArrayChange(
    changes,
    tr(locale, 'Основные мышцы', 'Primary muscles'),
    exercise.primaryMuscles,
    merged.primaryMuscles,
  );
  appendArrayChange(
    changes,
    tr(locale, 'Дополнительные мышцы', 'Secondary muscles'),
    exercise.secondaryMuscles,
    merged.secondaryMuscles,
  );
  appendArrayChange(
    changes,
    tr(locale, 'Оборудование', 'Equipment'),
    exercise.equipment,
    merged.equipment,
  );
  if ((exercise.notes ?? null) !== merged.notes && merged.notes) {
    changes.push({ label: tr(locale, 'Техника', 'Technique'), value: merged.notes });
  }
  const newSources = merged.sources.filter(
    (item) => !(exercise.sources ?? []).some((existing) => existing.url === item.url),
  );
  const newVideos = merged.videos.filter(
    (item) => !(exercise.videos ?? []).some((existing) => existing.url === item.url),
  );
  if (newSources.length) {
    changes.push({ label: tr(locale, 'Источники', 'Sources'), value: `+${newSources.length}` });
  }
  if (newVideos.length) {
    changes.push({ label: tr(locale, 'Видео', 'Videos'), value: `+${newVideos.length}` });
  }
  return changes;
}

function appendArrayChange(
  changes: Array<{ label: string; value: string }>,
  label: string,
  current: string[],
  next: string[],
) {
  const additions = next.filter((item) => !current.includes(item));
  if (additions.length) changes.push({ label, value: additions.join(', ') });
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function uniqueLinks<T extends { url: string }>(values: T[]) {
  return [...new Map(values.map((value) => [value.url, value])).values()];
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
}
