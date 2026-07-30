import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { ExerciseDiscoveryPanel } from './ExerciseDiscoveryPanel';

it('preserves the unresolved catalog query in the online discovery field', () => {
  const html = renderToStaticMarkup(
    <ExerciseDiscoveryPanel
      autoSearch
      initialQuery="Тяга сумо а"
      locale="ru"
      onExerciseSaved={async () => {}}
    />,
  );

  expect(html).toContain('value="Тяга сумо а"');
  expect(html).toContain('>Найти<');
});
