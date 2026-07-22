import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PushReminderSettings } from './PushReminderSettings';

describe('PushReminderSettings', () => {
  it('does not ask for permission while the settings screen renders', () => {
    const html = renderToStaticMarkup(<PushReminderSettings />);
    expect(html).toContain('Напоминания');
    expect(html).toContain('Проверяем');
    expect(html).not.toContain('Разрешить и включить');
  });
});
