import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { VoiceProcessingStage } from './VoicePanel';

it('makes command recognition primary and cancellation secondary', () => {
  const html = renderToStaticMarkup(<VoiceProcessingStage locale="ru" onCancel={() => {}} />);

  expect(html).toContain('Распознаю команду');
  expect(html).toContain('class="voice-processing-cancel"');
  expect(html.match(/<i><\/i>/g)).toHaveLength(15);
  expect(html).toContain('>Отменить<');
  expect(html).not.toContain('Дать команду');
});
