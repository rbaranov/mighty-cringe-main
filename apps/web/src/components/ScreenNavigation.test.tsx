import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { BackButton, ScreenNavigation } from './ScreenNavigation';

describe('ScreenNavigation', () => {
  it('makes the visible title and chevron a single back button', () => {
    const html = renderToStaticMarkup(
      <ScreenNavigation
        backLabel="К настройкам"
        onBack={vi.fn()}
        title="Язык и единицы измерения"
      />,
    );
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];

    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toContain('aria-label="К настройкам"');
    expect(buttons[0]).toContain('<svg aria-hidden="true"');
    expect(buttons[0]).toContain('>Язык и единицы измерения</span>');
    expect(html.match(/Язык и единицы измерения/g)).toHaveLength(1);
  });

  it('blocks the keyboard-safe press callback while navigation is disabled', () => {
    const onBack = vi.fn();
    const disabled = BackButton({ disabled: true, label: 'К упражнению', onBack });

    expect(disabled.props.disabled).toBe(true);
    disabled.props.onPress();
    expect(onBack).not.toHaveBeenCalled();

    BackButton({ disabled: false, label: 'К упражнению', onBack }).props.onPress();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
