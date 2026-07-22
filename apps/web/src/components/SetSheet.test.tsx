import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Exercise } from '@mighty-cringe/contracts';

import { SetSheet } from './SetSheet';

const exercise: Exercise = {
  id: '10000000-0000-4000-8000-000000000003',
  nameRu: 'Жим лёжа',
  nameEn: 'Bench press',
  aliases: [],
  tag: 'mighty',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['triceps'],
  equipment: ['barbell'],
};

describe('SetSheet', () => {
  it('opens without forcing iOS Safari to focus and move the viewport', () => {
    const html = renderToStaticMarkup(
      <SetSheet
        exercise={exercise}
        initial={null}
        onClose={() => {}}
        onExplain={() => {}}
        onSave={() => {}}
      />,
    );

    expect(html).toContain('class="sheet set-sheet"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).not.toContain('autofocus');
  });
});
