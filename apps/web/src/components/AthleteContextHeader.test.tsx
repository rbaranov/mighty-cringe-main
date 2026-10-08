import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { CurrentUser, TrainerAthleteSummary } from '@mighty-cringe/contracts';

import { beginConfirmation } from '../lib/confirmation';
import { AthleteContextLabel, AthleteContextProvider } from './AthleteContext';
import { AthleteContextHeader } from './AthleteContextHeader';
import { ConfirmationSheet } from './ConfirmationSheet';

const user: CurrentUser = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'coach@example.test',
  displayName: 'Роман Тренер',
  avatarUrl: null,
  role: 'trainer',
  locale: 'ru',
  unitSystem: 'metric',
};
const athlete: TrainerAthleteSummary = {
  id: '10000000-0000-4000-8000-000000000002',
  displayName: 'Дмитрий Александрович Иванов',
  avatarUrl: null,
  access: 'manage',
  linkId: '10000000-0000-4000-8000-000000000009',
  linkedAt: '2026-10-08T00:00:00.000Z',
};

function renderHeader(selected: TrainerAthleteSummary | null, actor = user) {
  return renderToStaticMarkup(
    <AthleteContextHeader
      user={actor}
      athlete={selected}
      athletes={[
        athlete,
        {
          ...athlete,
          id: '10000000-0000-4000-8000-000000000003',
          displayName: 'Подопечный без разрешения',
          access: 'read',
        },
      ]}
      onSelectAthlete={vi.fn()}
      onReturnToSelf={vi.fn()}
      onManageAthletes={vi.fn()}
    />,
  );
}

describe('athlete context identity', () => {
  it('keeps full selected identity accessible, an explicit return, and both access levels in the chooser', () => {
    const html = renderHeader(athlete);
    expect(html).toContain(`Подопечный: ${athlete.displayName}. Сменить профиль`);
    expect(html).toContain('>К себе</button>');
    expect(html).toContain('Просмотр и изменения');
    expect(html).toContain('Только просмотр');
    expect(html).toContain('Управлять подопечными');
    expect(html).not.toContain('Привет, Дмитрий');
  });

  it('keeps the coach greeting in self mode and does not show a return control', () => {
    const html = renderHeader(null);
    expect(html).toContain('Привет, Роман 👋');
    expect(html).toContain('Мои тренировки. Выбрать подопечного');
    expect(html).not.toContain('>К себе</button>');
  });

  it('does not expose the coach chooser to ordinary athletes', () => {
    const html = renderHeader(null, { ...user, role: 'athlete' });
    expect(html).not.toContain('<details');
    expect(html).toContain('Привет, Роман 👋');
  });

  it('names the data owner inside destructive confirmations and stays absent in the own log', () => {
    const confirmation = beginConfirmation({
      steps: [{ title: 'Удалить подход?', message: 'Запись исчезнет.', confirmLabel: 'Удалить' }],
      action: vi.fn(),
    });
    const html = renderToStaticMarkup(
      <AthleteContextProvider athlete={athlete}>
        <ConfirmationSheet confirmation={confirmation} onClose={vi.fn()} onConfirm={vi.fn()} />
      </AthleteContextProvider>,
    );
    expect(html).toContain(athlete.displayName);
    expect(html.indexOf(athlete.displayName)).toBeLessThan(html.indexOf('<h2>Удалить подход?'));
    expect(renderToStaticMarkup(<AthleteContextLabel />)).toBe('');
  });
});
