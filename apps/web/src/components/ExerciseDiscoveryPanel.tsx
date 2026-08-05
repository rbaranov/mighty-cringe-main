import { useEffect, useRef, useState } from 'react';

import type {
  CurrentUser,
  Exercise,
  ExerciseDiscoveryCandidate,
  ExerciseDiscoveryJob,
  ExerciseDiscoveryPhase,
} from '@mighty-cringe/contracts';

import {
  cancelExerciseDiscovery,
  createPersonalExercise,
  getExerciseDiscovery,
  startExerciseDiscovery,
} from '../lib/exercises';
import { KeyboardSafeButton } from './KeyboardSafeButton';

export function ExerciseDiscoveryPanel({
  autoSearch = false,
  existingExercises = [],
  exerciseId,
  initialQuery = '',
  locale,
  onCandidateSelected,
  onExerciseSaved,
}: {
  autoSearch?: boolean;
  existingExercises?: Exercise[];
  exerciseId?: string;
  initialQuery?: string;
  locale: CurrentUser['locale'];
  onCandidateSelected?: (candidate: ExerciseDiscoveryCandidate) => Promise<void>;
  onExerciseSaved?: (exercise: Exercise) => Promise<void>;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [candidates, setCandidates] = useState<ExerciseDiscoveryCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [job, setJob] = useState<ExerciseDiscoveryJob | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const automaticSearch = useRef('');
  const activeJobId = useRef<string | null>(null);
  const refreshingJob = useRef(false);

  useEffect(() => {
    setQuery(initialQuery);
    setCandidates(null);
    setSavedName(null);
    setError(null);
    setJob(null);
    setElapsedSeconds(0);
    const normalizedInitialQuery = initialQuery.trim();
    if (
      autoSearch &&
      normalizedInitialQuery.length >= 2 &&
      automaticSearch.current !== normalizedInitialQuery
    ) {
      automaticSearch.current = normalizedInitialQuery;
      void search(normalizedInitialQuery);
    }
  }, [autoSearch, initialQuery]);

  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const updateElapsed = () => {
      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - new Date(job.startedAt).getTime()) / 1_000)),
      );
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    const poll = window.setInterval(() => void refreshJob(job.id), 500);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(poll);
    };
  }, [job?.id, job?.status]);

  useEffect(
    () => () => {
      const jobId = activeJobId.current;
      if (jobId) void cancelExerciseDiscovery(jobId).catch(() => undefined);
    },
    [],
  );

  async function search(searchQuery = query) {
    if (searching || searchQuery.trim().length < 2) return;
    setSearching(true);
    setCandidates(null);
    setSavedName(null);
    setError(null);
    try {
      const started = await startExerciseDiscovery(searchQuery.trim(), locale, exerciseId);
      activeJobId.current = started.id;
      setJob(started);
      setElapsedSeconds(0);
    } catch (caught) {
      setError(discoveryError(caught, locale));
      setSearching(false);
    }
  }

  async function refreshJob(jobId: string) {
    if (activeJobId.current !== jobId || refreshingJob.current) return;
    refreshingJob.current = true;
    try {
      const current = await getExerciseDiscovery(jobId);
      if (activeJobId.current !== jobId) return;
      setJob(current);
      if (current.status === 'completed') {
        activeJobId.current = null;
        setCandidates(current.result?.candidates ?? []);
        setSearching(false);
      } else if (current.status === 'failed') {
        activeJobId.current = null;
        setError(discoveryError(new Error('discovery_unavailable'), locale));
        setSearching(false);
      } else if (current.status === 'cancelled') {
        activeJobId.current = null;
        setSearching(false);
      }
    } catch (caught) {
      activeJobId.current = null;
      setError(discoveryError(caught, locale));
      setSearching(false);
    } finally {
      refreshingJob.current = false;
    }
  }

  async function cancelSearch() {
    const jobId = activeJobId.current;
    if (!jobId) return;
    activeJobId.current = null;
    setSearching(false);
    setJob((current) => (current ? { ...current, status: 'cancelled' } : current));
    try {
      await cancelExerciseDiscovery(jobId);
    } catch {
      setError(
        tr(
          locale,
          'Поиск закрыт здесь, но сервер не подтвердил отмену.',
          'Search was closed here, but the server did not confirm cancellation.',
        ),
      );
    }
  }

  async function save(candidate: ExerciseDiscoveryCandidate, index: number) {
    if (savingIndex !== null) return;
    setSavingIndex(index);
    setError(null);
    try {
      if (onCandidateSelected) {
        await onCandidateSelected(candidate);
        return;
      }
      if (!onExerciseSaved) throw new Error('Missing exercise save handler');
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

  async function useExisting(exercise: Exercise) {
    if (!onExerciseSaved) return;
    setError(null);
    await onExerciseSaved(exercise);
    setSavedName(exerciseName(exercise, locale));
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
          disabled={searching}
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
        <KeyboardSafeButton
          className="button primary"
          disabled={searching || query.trim().length < 2}
          onPress={() => void search()}
          type="button"
        >
          {searching
            ? tr(locale, `Ищу · ${elapsedSeconds} с`, `Searching · ${elapsedSeconds}s`)
            : tr(locale, 'Найти', 'Find')}
        </KeyboardSafeButton>
      </div>
      <p className="discovery-hint">
        {tr(
          locale,
          'Поиск отдельно проверяет источники и прямое видео с техникой. Упражнение попадёт только в твой каталог и только после подтверждения.',
          'Search separately verifies sources and a direct technique video. The exercise is added only to your catalog and only after confirmation.',
        )}
      </p>

      {job?.status === 'running' && (
        <div className="discovery-progress" role="status">
          <div className="discovery-progress-heading">
            <strong>
              {tr(
                locale,
                `Проверяю интернет · ${elapsedSeconds} с`,
                `Checking online · ${elapsedSeconds}s`,
              )}
            </strong>
            <button onClick={() => void cancelSearch()} type="button">
              {tr(locale, 'Отменить', 'Cancel')}
            </button>
          </div>
          <ol>
            {job.phases.map((phase) => (
              <li className={phase.status} key={phase.phase}>
                <span aria-hidden="true">{phaseIcon(phase.status)}</span>
                {phaseLabel(phase.phase, locale)}
              </li>
            ))}
          </ol>
          {elapsedSeconds >= 15 && (
            <p>
              {tr(
                locale,
                'Это дольше обычного. Можно отменить поиск и создать упражнение вручную.',
                'This is taking longer than usual. You can cancel and create the exercise manually.',
              )}
            </p>
          )}
        </div>
      )}
      {job?.status === 'cancelled' && (
        <p className="clarification compact" role="status">
          {tr(
            locale,
            'Поиск отменён. Описание сохранено — его можно уточнить или повторить поиск.',
            'Search cancelled. Your description is preserved so you can refine it or try again.',
          )}
        </p>
      )}

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
            'Надёжных совпадений не найдено. Уточни название или опиши движение и оборудование — либо вернись и создай упражнение вручную.',
            'No reliable match was found. Refine the name or describe the movement and equipment, or go back and create the exercise manually.',
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
      {candidates?.map((candidate, index) => {
        const existing = findExistingExercise(candidate, existingExercises);
        return (
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
            {candidate.videos.length === 0 && (
              <p className="discovery-video-missing">
                {tr(
                  locale,
                  'Видео с подтверждённой ссылкой пока не найдено. Упражнение всё равно можно использовать.',
                  'No verified video link was found yet. You can still use the exercise.',
                )}
              </p>
            )}
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
              onClick={() => void (existing ? useExisting(existing) : save(candidate, index))}
              type="button"
            >
              {existing
                ? tr(locale, 'Уже в каталоге — использовать', 'Already in catalog — use')
                : savingIndex === index
                  ? tr(locale, 'Добавляю…', 'Adding…')
                  : onCandidateSelected
                    ? tr(locale, 'Выбрать эти данные', 'Use these details')
                    : tr(locale, 'Добавить и использовать', 'Add and use')}
            </button>
          </article>
        );
      })}
    </section>
  );
}

function findExistingExercise(
  candidate: ExerciseDiscoveryCandidate,
  exercises: Exercise[],
): Exercise | undefined {
  const candidateNames = new Set(
    [candidate.nameRu, candidate.nameEn].map((name) => normalizeName(name)),
  );
  return exercises.find((exercise) =>
    [exercise.nameRu, exercise.nameEn].some((name) => candidateNames.has(normalizeName(name))),
  );
}

function normalizeName(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
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

function phaseLabel(phase: ExerciseDiscoveryPhase, locale: 'ru' | 'en') {
  const labels: Record<ExerciseDiscoveryPhase, [string, string]> = {
    information: ['Ищу описание и варианты названия', 'Finding descriptions and name variants'],
    video: ['Ищу видео с техникой', 'Finding technique videos'],
    structuring: ['Собираю данные карточки', 'Building the exercise details'],
    verification: ['Сверяю источники и ссылки', 'Verifying sources and links'],
  };
  return labels[phase][locale === 'en' ? 1 : 0];
}

function phaseIcon(status: ExerciseDiscoveryJob['phases'][number]['status']) {
  if (status === 'completed') return '✓';
  if (status === 'failed') return '!';
  if (status === 'skipped') return '–';
  if (status === 'running') return '●';
  return '○';
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
