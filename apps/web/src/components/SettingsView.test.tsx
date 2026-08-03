import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { CurrentUser } from '@mighty-cringe/contracts';

import { PreferencesProvider } from '../lib/preferences';
import { DataExportPanel } from './DataExportPanel';
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
          onResolveConflict={vi.fn()}
          onUserUpdated={vi.fn()}
          relationshipRefreshKey={0}
          user={user}
        />
      </PreferencesProvider>,
    );

    const account = html.indexOf('Аккаунт');
    const data = html.indexOf('Данные и экспорт');
    const coach = html.indexOf('Тренер и доступ');
    const athletes = html.indexOf('Подопечные');
    const notifications = html.indexOf('Уведомления');
    const audio = html.indexOf('Аудиокоманды');
    const preferences = html.indexOf('Язык и единицы измерения');

    expect(account).toBeGreaterThan(-1);
    expect(data).toBeGreaterThan(account);
    expect(coach).toBeGreaterThan(data);
    expect(athletes).toBeGreaterThan(coach);
    expect(notifications).toBeGreaterThan(athletes);
    expect(audio).toBeGreaterThan(notifications);
    expect(preferences).toBeGreaterThan(audio);
    expect(html).not.toContain('Записи команд');
    expect(html).toContain('Локальная копия тренировок и замеров');
    expect(html).toContain('интенсивных силовых тренировок');
    expect(html).toContain('Минимум лишних действий — максимум честно зафиксированной работы.');
    expect(html).toContain('⚡ Mighty');
    expect(html).toContain('😬 Cringe');
    expect(html).toContain('Отсюда и название 😁');
    const productAudience = html.indexOf('MightyCringe создан для людей');
    const honeyBadger = html.indexOf('На иконке приложения — медоед');
    const author = html.indexOf('Автор — Роман Баранов');
    expect(productAudience).toBeGreaterThan(-1);
    expect(honeyBadger).toBeGreaterThan(productAudience);
    expect(author).toBeGreaterThan(honeyBadger);
    expect(html).toContain('>он крут и ему на всё пофиг</a>.');
    expect(html).toContain('href="https://www.youtube.com/watch?v=K7w6b4gs2-E"');
    expect(html).toContain('но не слишком серьёзно относятся к себе');
    expect(html).toContain('Автор — Роман Баранов. Связаться с автором:');
    expect(html).toContain('href="#about-mighty-cringe"');
    expect(html).toContain('id="about-mighty-cringe"');
    expect(html).not.toContain('class="profile-card"');
    expect(html).toContain('tg @rbaranov');
    expect(html).toContain('rbaranov@me.com');
    expect(html).not.toContain('<select');
  });

  it('links the English honey-badger story to the English video', () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider locale="en" unitSystem="metric">
        <SettingsView
          conflicts={[]}
          onLogout={vi.fn()}
          onOpenTrainer={vi.fn()}
          onResolveConflict={vi.fn()}
          onUserUpdated={vi.fn()}
          relationshipRefreshKey={0}
          user={{ ...user, locale: 'en' }}
        />
      </PreferencesProvider>,
    );

    expect(html).toContain('The app icon features a honey badger');
    expect(html).toContain('href="https://www.youtube.com/watch?v=4r7wHMg5Yjg"');
    expect(html).toContain('>he is cool and does not give a damn</a>.');
    expect(html).not.toContain('Watch the video');
  });

  it('explains the offline JSON export and its privacy boundary', () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider locale="ru" unitSystem="metric">
        <DataExportPanel />
      </PreferencesProvider>,
    );

    expect(html).toContain('Копия данных этого устройства');
    expect(html).toContain('Работает офлайн');
    expect(html).toContain('которые ещё не синхронизировались');
    expect(html).toContain('Сохранить в Файлы');
    expect(html).toContain('Импорт в приложение пока не поддерживается');
    expect(html).toContain('disabled=""');
  });
});
