import { useEffect, useState } from 'react';

import type { CurrentUser, Exercise, ExerciseDiscoveryCandidate } from '@mighty-cringe/contracts';

import { createPersonalExercise, discoverExercises } from '../lib/exercises';

export function ExerciseDiscoveryPanel({
  initialQuery = '',
  locale,
  onExerciseSaved,
}: {
  initialQuery?: string;
  locale: CurrentUser['locale'];
  onExerciseSaved: (exercise: Exercise) => Promise<void>;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [candidates, setCandidates] = useState<ExerciseDiscoveryCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQuery(initialQuery);
    setCandidates(null);
    setSavedName(null);
    setError(null);
  }, [initialQuery]);

  async function search() {
    if (searching || query.trim().length < 2) return;
    setSearching(true);
    setCandidates(null);
    setSavedName(null);
    setError(null);
    try {
      const result = await discoverExercises(query.trim(), locale);
      setCandidates(result.candidates);
    } catch (caught) {
      setError(discoveryError(caught, locale));
    } finally {
      setSearching(false);
    }
  }

  async function save(candidate: ExerciseDiscoveryCandidate, index: number) {
    if (savingIndex !== null) return;
    setSavingIndex(index);
    setError(null);
    try {
      const exercise = await createPersonalExercise(candidate);
      await onExerciseSaved(exercise);
      setSavedName(exerciseName(exercise, locale));
    } catch {
      setError(
        tr(
          locale,
          'Не удалось добавить упражнение. Ничего не потерялось — попробуй ещё раз.',
          'Could not add the exercise. Nothing was lost — try again.',
        ),
      );
    } finally {
      setSavingIndex(null);
    }
  }

  return (
    <section
      className="exercise-discovery"
      aria-label={tr(locale, 'Поиск упражнения', 'Exercise search')}
    >
      <label htmlFor="exercise-discovery-query">
        {tr(locale, 'Как упражнение называют?', 'What is the exercise called?')}
      </label>
      <div className="exercise-discovery-search">
        <input
          id="exercise-discovery-query"
          maxLength={200}
          onChange={(event) => {
            setQuery(event.target.value);
            setCandidates(null);
            setSavedName(null);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void search();
            }
          }}
          placeholder={tr(locale, 'Например: тяга Арни', 'For example: Arnold row')}
          type="search"
          value={query}
        />
        <button
          className="button primary"
          disabled={searching || query.trim().length < 2}
          onClick={() => void search()}
          type="button"
        >
          {searching ? tr(locale, 'Ищу…', 'Searching…') : tr(locale, 'Найти', 'Find')}
        </button>
      </div>
      <p className="discovery-hint">
        {tr(
          locale,
          'Поиск проверяет веб-источники. Упражнение попадёт только в твой каталог и только после подтверждения.',
          'Search checks web sources. The exercise is added only to your catalog and only after confirmation.',
        )}
      </p>

      {error && (
        <p className="clarification compact" role="alert">
          {error}
        </p>
      )}
      {savedName && (
        <p className="discovery-success" role="status">
          {tr(
            locale,
            `«${savedName}» добавлено в личный каталог.`,
            `“${savedName}” was added to your catalog.`,
          )}
        </p>
      )}
      {candidates?.length === 0 && (
        <p className="clarification compact" role="status">
          {tr(
            locale,
            'Надёжных совпадений не найдено. Уточни название или опиши движение и оборудование.',
            'No reliable match was found. Refine the name or describe the movement and equipment.',
          )}
        </p>
      )}
      {candidates && candidates.length > 1 && (
        <p className="discovery-ambiguity">
          {tr(
            locale,
            'Название неоднозначное. Выбери движение, которое ты имел в виду:',
            'The name is ambiguous. Choose the movement you meant:',
          )}
        </p>
      )}
      {candidates?.map((candidate, index) => (
        <article className="discovery-candidate" key={`${candidate.nameEn}-${index}`}>
          <div className="discovery-candidate-head">
            <div>
              <strong>{exerciseName(candidate, locale)}</strong>
              <small>{locale === 'en' ? candidate.nameRu : candidate.nameEn}</small>
            </div>
            <span className={`confidence ${candidate.confidence}`}>
              {confidenceLabel(candidate.confidence, locale)}
            </span>
          </div>
          <p>{candidate.matchReason}</p>
          <dl className="discovery-facts">
            <div>
              <dt>{tr(locale, 'Мышцы', 'Muscles')}</dt>
              <dd>{candidate.primaryMuscles.join(', ')}</dd>
            </div>
            <div>
              <dt>{tr(locale, 'Оборудование', 'Equipment')}</dt>
              <dd>{candidate.equipment.join(', ') || '—'}</dd>
            </div>
          </dl>
          {candidate.notes && <p className="discovery-notes">{candidate.notes}</p>}
          {candidate.videos.map((video) => {
            const embed = youtubeEmbedUrl(video.url);
            return embed ? (
              <iframe
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="exercise-video"
                key={video.url}
                loading="lazy"
                src={embed}
                title={video.title}
              />
            ) : (
              <a href={video.url} key={video.url} rel="noreferrer" target="_blank">
                {video.title}
              </a>
            );
          })}
          <div className="discovery-sources">
            <span>{tr(locale, 'Источники:', 'Sources:')}</span>
            {candidate.sources.map((source) => (
              <a href={source.url} key={source.url} rel="noreferrer" target="_blank">
                {source.title}
              </a>
            ))}
          </div>
          <button
            className="button primary full"
            disabled={savingIndex !== null || Boolean(savedName)}
            onClick={() => void save(candidate, index)}
            type="button"
          >
            {savingIndex === index
              ? tr(locale, 'Добавляю…', 'Adding…')
              : tr(locale, 'Добавить и использовать', 'Add and use')}
          </button>
        </article>
      ))}
    </section>
  );
}

function exerciseName(exercise: Pick<Exercise, 'nameRu' | 'nameEn'>, locale: 'ru' | 'en') {
  return locale === 'en' ? exercise.nameEn : exercise.nameRu;
}

function confidenceLabel(
  confidence: ExerciseDiscoveryCandidate['confidence'],
  locale: 'ru' | 'en',
) {
  if (confidence === 'high') return tr(locale, 'точное', 'strong');
  if (confidence === 'medium') return tr(locale, 'возможное', 'possible');
  return tr(locale, 'слабое', 'weak');
}

function discoveryError(error: unknown, locale: 'ru' | 'en') {
  if (error instanceof Error && error.message === 'discovery_not_configured') {
    return tr(
      locale,
      'Онлайн-поиск пока не настроен на сервере. Нужны OpenRouter credentials.',
      'Online search is not configured on the server yet. OpenRouter credentials are required.',
    );
  }
  return tr(
    locale,
    'Поиск сейчас недоступен. Проверь подключение и попробуй ещё раз.',
    'Search is unavailable right now. Check the connection and try again.',
  );
}

function youtubeEmbedUrl(value: string) {
  try {
    const url = new URL(value);
    let id: string | null = null;
    if (url.hostname === 'youtu.be') id = url.pathname.slice(1).split('/')[0] ?? null;
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else if (/^\/(?:shorts|embed)\//u.test(url.pathname)) id = url.pathname.split('/')[2] ?? null;
    }
    return id && /^[A-Za-z0-9_-]{6,20}$/u.test(id)
      ? `https://www.youtube-nocookie.com/embed/${id}`
      : null;
  } catch {
    return null;
  }
}

function tr(locale: 'ru' | 'en', ru: string, en: string) {
  return locale === 'en' ? en : ru;
}
