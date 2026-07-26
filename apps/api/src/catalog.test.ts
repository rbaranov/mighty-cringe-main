import assert from 'node:assert/strict';
import test from 'node:test';

import { catalog } from './catalog.js';

test('every global exercise has one playable featured YouTube video', () => {
  assert.equal(catalog.length, 16);
  for (const exercise of catalog) {
    assert.equal(exercise.videos?.length, 1, `${exercise.nameRu} needs one featured video`);
    assert.match(
      exercise.videos?.[0]?.url ?? '',
      /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/u,
      `${exercise.nameRu} needs a direct YouTube URL`,
    );
  }
});
