import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { beginConfirmation } from '../lib/confirmation';
import { PreferencesProvider } from '../lib/preferences';
import { ConfirmationSheet } from './ConfirmationSheet';

describe('ConfirmationSheet', () => {
  it('renders both numbered Russian steps without mixing their actions', () => {
    const first = beginConfirmation({
      steps: [
        { title: 'Удалить тренировку?', message: 'Проверь детали', confirmLabel: 'Продолжить' },
        {
          title: 'Точно удалить тренировку?',
          message: 'Финальное предупреждение',
          confirmLabel: 'Удалить тренировку',
        },
      ],
      action: async () => {},
    });

    const firstHtml = render(first, 'ru');
    const secondHtml = render({ ...first, stepIndex: 1 }, 'ru');

    expect(firstHtml).toContain('Подтверждение 1 из 2');
    expect(firstHtml).toContain('>Продолжить</button>');
    expect(firstHtml).not.toContain('Финальное предупреждение');
    expect(secondHtml).toContain('Подтверждение 2 из 2');
    expect(secondHtml).toContain('Финальное предупреждение');
    expect(secondHtml).toContain('>Удалить тренировку</button>');
  });

  it('renders the numbered flow in English and keeps one-step confirmations unnumbered', () => {
    const multiple = beginConfirmation({
      steps: [
        { title: 'Delete?', message: 'Review', confirmLabel: 'Continue' },
        { title: 'Delete now?', message: 'Final', confirmLabel: 'Delete' },
      ],
      action: async () => {},
    });
    const single = beginConfirmation({
      steps: [{ title: 'Delete set?', message: 'One set', confirmLabel: 'Delete set' }],
      action: async () => {},
    });

    expect(render(multiple, 'en')).toContain('Confirmation 1 of 2');
    expect(render({ ...multiple, stepIndex: 1 }, 'en')).toContain('Confirmation 2 of 2');
    expect(render(single, 'en')).toContain('>Confirmation</p>');
    expect(render(single, 'en')).not.toContain('Confirmation 1 of 1');
  });
});

function render(confirmation: ReturnType<typeof beginConfirmation>, locale: 'ru' | 'en') {
  return renderToStaticMarkup(
    <PreferencesProvider locale={locale} unitSystem="metric">
      <ConfirmationSheet confirmation={confirmation} onClose={() => {}} onConfirm={() => {}} />
    </PreferencesProvider>,
  );
}
