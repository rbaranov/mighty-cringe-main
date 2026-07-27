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
  it('shows concise sections and styled preference entry points instead of native selects', () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider locale="ru" unitSystem="metric">
        <SettingsView
          conflicts={[]}
          onLogout={vi.fn()}
          onUserUpdated={vi.fn()}
          relationshipRefreshKey={0}
          user={user}
        />
      </PreferencesProvider>,
    );

    expect(html).toContain('Язык и единицы');
    expect(html).toContain('Уведомления');
    expect(html).toContain('Аудиокоманды');
    expect(html).toContain('Записи команд');
    expect(html).toContain('Тренер и доступ');
    expect(html).not.toContain('<select');
  });
});
