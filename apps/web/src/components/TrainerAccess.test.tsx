import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TrainerDashboard } from './TrainerAccess';

describe('TrainerDashboard', () => {
  it('states the read-only boundary before any athlete data is loaded', () => {
    const html = renderToStaticMarkup(<TrainerDashboard onBack={() => {}} />);
    expect(html).toContain('Подопечные');
    expect(html).toContain('Только чтение');
    expect(html).toContain('Создать ссылку на 7 дней');
    expect(html).not.toContain('Изменить тренировку');
  });
});
