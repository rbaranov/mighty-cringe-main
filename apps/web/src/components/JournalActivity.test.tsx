import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as dataContext from '../lib/dataContext';
import { PreferencesProvider } from '../lib/preferences';
import { JournalActivityList, loadJournalActivity } from './JournalActivity';

afterEach(() => vi.restoreAllMocks());

const entry = {
  id: 'activity-1',
  actorDisplayName: 'Роман Тренер',
  action: 'set.create',
  createdAt: '2026-10-08T10:30:00.000Z',
};

describe('coach journal activity', () => {
  it('uses the captured owner context and cancellation signal for the request', async () => {
    const context = dataContext.getDataContext();
    const controller = new AbortController();
    const request = vi
      .spyOn(dataContext, 'sportingRequest')
      .mockResolvedValue(Response.json({ items: [entry] }));
    expect(await loadJournalActivity(context, controller.signal)).toEqual([entry]);
    expect(request).toHaveBeenCalledWith(
      '/api/v1/journal-activity',
      { signal: controller.signal },
      context,
    );
  });

  it('does not interpret failed requests as an empty activity log', async () => {
    vi.spyOn(dataContext, 'sportingRequest').mockResolvedValue(
      Response.json({ error: 'forbidden' }, { status: 403 }),
    );
    await expect(loadJournalActivity(dataContext.getDataContext())).rejects.toThrow(
      'journal_activity_unavailable',
    );
  });

  it('shows readable action, author and timestamp without exposing technical names', () => {
    const html = renderToStaticMarkup(
      <JournalActivityList
        items={[entry, { ...entry, id: 'activity-2', action: 'future.action' }]}
      />,
    );
    expect(html).toContain('Добавлен подход');
    expect(html).toContain('Роман Тренер');
    expect(html).toContain('dateTime="2026-10-08T10:30:00.000Z"');
    expect(html).toContain('Обновлён журнал тренировок');
    expect(html).not.toContain('set.create');
    expect(html).not.toContain('future.action');
  });

  it('localizes the empty state and destructive actions', () => {
    expect(renderToStaticMarkup(<JournalActivityList items={[]} />)).toContain(
      'Изменений тренера пока нет',
    );
    const html = renderToStaticMarkup(
      <PreferencesProvider locale="en" unitSystem="metric">
        <JournalActivityList items={[{ ...entry, action: 'workout.delete' }]} />
      </PreferencesProvider>,
    );
    expect(html).toContain('Workout deleted');
  });
});
