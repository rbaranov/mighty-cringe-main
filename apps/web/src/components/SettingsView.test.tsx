import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { CurrentUser } from '@mighty-cringe/contracts';

import { PreferencesProvider } from '../lib/preferences';
import { SettingsView } from './SettingsView';

const user: CurrentUser = {
  id: '70000000-0000-4000-8000-000000000001',
  email: 'athlete@example.test',
  displayName: 'Athlete',
  avatarUrl: null,
  role: 'athlete',
  locale: 'ru',
  unitSystem: 'metric',
};

describe('SettingsView', () => {
  it('shows the requested section order, nests recordings, and includes the product story', () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider locale="ru" unitSystem="metric">
        <SettingsView
          conflicts={[]}
          onLogout={vi.fn()}
          onOpenTrainer={vi.fn()}
          onUserUpdated={vi.fn()}
          relationshipRefreshKey={0}
          user={user}
        />
      </PreferencesProvider>,
    );

    const account = html.indexOf('Аккаунт');
    const coach = html.indexOf('Тренер и доступ');
    const athletes = html.indexOf('Подопечные');
    const notifications = html.indexOf('Уведомления');
    const audio = html.indexOf('Аудиокоманды');
    const preferences = html.indexOf('Язык и единицы измерения');

    expect(account).toBeGreaterThan(-1);
    expect(coach).toBeGreaterThan(account);
    expect(athletes).toBeGreaterThan(coach);
    expect(notifications).toBeGreaterThan(athletes);
    expect(audio).toBeGreaterThan(notifications);
    expect(preferences).toBeGreaterThan(audio);
    expect(html).not.toContain('Записи команд');
    expect(html).toContain('интенсивных силовых тренировок');
    expect(html).toContain('⚡ Mighty');
    expect(html).toContain('😬 Cringe');
    expect(html).toContain('Автор — Роман Баранов.');
    expect(html).toContain('href="#about-mighty-cringe"');
    expect(html).toContain('id="about-mighty-cringe"');
    expect(html).not.toContain('class="profile-card"');
    expect(html).toContain('tg @rbaranov');
    expect(html).toContain('rbaranov@me.com');
    expect(html).not.toContain('<select');
  });
});
