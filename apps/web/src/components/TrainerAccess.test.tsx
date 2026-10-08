import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TrainerDashboard } from './TrainerAccess';

describe('TrainerDashboard', () => {
  it('explains that viewing and editing require separate athlete permissions', () => {
    const html = renderToStaticMarkup(<TrainerDashboard onBack={() => {}} />);
    expect(html).toContain('Подопечные');
    expect(html).toContain('Приглашение открывает просмотр тренировок и замеров');
    expect(html).toContain('Подопечный отдельно разрешает изменения');
    expect(html).toContain('Создать ссылку на 7 дней');
    expect(html).not.toContain('Изменить тренировку');
  });
});
