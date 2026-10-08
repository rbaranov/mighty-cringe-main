import { useEffect, useState, useSyncExternalStore } from 'react';

import {
  getDataContext,
  getDataContextKey,
  sportingRequest,
  subscribeDataContext,
  type DataContext,
} from '../lib/dataContext';
import { tr, usePreferences } from '../lib/preferences';
import './JournalActivity.css';

export type JournalActivityEntry = {
  id: string;
  actorDisplayName: string;
  action: string;
  createdAt: string;
};

export async function loadJournalActivity(context: DataContext, signal?: AbortSignal) {
  const response = await sportingRequest('/api/v1/journal-activity', { signal }, context);
  if (!response.ok) throw new Error('journal_activity_unavailable');
  return ((await response.json()) as { items: JournalActivityEntry[] }).items;
}

export function JournalActivity() {
  const { locale } = usePreferences();
  const contextKey = useSyncExternalStore(
    subscribeDataContext,
    getDataContextKey,
    getDataContextKey,
  );
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{
    key: string;
    items: JournalActivityEntry[];
    loading: boolean;
    failed: boolean;
  }>({ key: '', items: [], loading: true, failed: false });

  useEffect(() => {
    const context = getDataContext();
    const controller = new AbortController();
    let active = true;
    setState((previous) => ({
      key: context.key,
      items: previous.key === context.key ? previous.items : [],
      loading: true,
      failed: false,
    }));
    void loadJournalActivity(context, controller.signal)
      .then((items) => {
        if (active) setState({ key: context.key, items, loading: false, failed: false });
      })
      .catch(() => {
        if (active) setState({ key: context.key, items: [], loading: false, failed: true });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [contextKey, refresh]);

  const current = state.key === contextKey ? state : null;
  const loading = !current || current.loading;
  return (
    <section
      className="journal-activity"
      aria-label={tr(locale, 'Изменения тренера', 'Coach activity')}
    >
      <div className="journal-activity-heading">
        <h2>{tr(locale, 'Изменения тренера', 'Coach activity')}</h2>
        <button
          className="button ghost small"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
          type="button"
        >
          {tr(locale, 'Обновить', 'Refresh')}
        </button>
      </div>
      {loading && <p role="status">{tr(locale, 'Загружаем изменения…', 'Loading activity…')}</p>}
      {current?.failed && (
        <p role="status">
          {tr(
            locale,
            'Не удалось загрузить изменения. Проверь подключение и попробуй ещё раз.',
            'Could not load activity. Check your connection and try again.',
          )}
        </p>
      )}
      {current && !current.failed && (!loading || current.items.length > 0) && (
        <JournalActivityList items={current.items} />
      )}
    </section>
  );
}

export function JournalActivityList({ items }: { items: JournalActivityEntry[] }) {
  const { locale } = usePreferences();
  if (!items.length)
    return <p>{tr(locale, 'Изменений тренера пока нет.', 'No coach changes yet.')}</p>;
  return (
    <ol className="journal-activity-list">
      {items.map((item) => (
        <li key={item.id}>
          <strong>{journalActionLabel(item.action, locale)}</strong>
          <span>{item.actorDisplayName}</span>
          <time dateTime={item.createdAt}>
            {new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(item.createdAt))}
          </time>
        </li>
      ))}
    </ol>
  );
}

function journalActionLabel(action: string, locale: 'ru' | 'en') {
  const labels: Record<string, [string, string]> = {
    'set.create': ['Добавлен подход', 'Set added'],
    'set.update': ['Изменён подход', 'Set edited'],
    'set.delete': ['Удалён подход', 'Set deleted'],
    'workout.create': ['Добавлена тренировка', 'Workout added'],
    'workout.update': ['Изменена тренировка', 'Workout edited'],
    'workout.delete': ['Удалена тренировка', 'Workout deleted'],
    'workout.touch': ['Обновлена текущая тренировка', 'Current workout updated'],
    'measurement.create': ['Добавлен замер', 'Measurement added'],
    'measurement.update': ['Изменён замер', 'Measurement edited'],
    'measurement.delete': ['Удалён замер', 'Measurement deleted'],
    'exercise.create': ['Добавлено упражнение в каталог', 'Catalog exercise added'],
    'exercise.update': ['Изменено упражнение в каталоге', 'Catalog exercise edited'],
    'exercise.delete': ['Удалено упражнение из каталога', 'Catalog exercise deleted'],
    'exercise-preference.set': ['Изменена оценка упражнения', 'Exercise preference changed'],
    'exercise.discover': ['Добавлено упражнение из поиска', 'Exercise added from search'],
    'exercise-discovery.start': ['Начат поиск упражнения', 'Exercise search started'],
    'exercise-discovery.cancel': ['Отменён поиск упражнения', 'Exercise search canceled'],
  };
  const label = labels[action] ?? ['Обновлён журнал тренировок', 'Training log updated'];
  return tr(locale, label[0], label[1]);
}
