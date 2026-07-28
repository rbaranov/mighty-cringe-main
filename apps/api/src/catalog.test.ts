import assert from 'node:assert/strict';
import test from 'node:test';

import { catalog } from './catalog.js';

test('the global catalog has stable unique entries and only direct featured videos', () => {
  assert.equal(catalog.length, 39);
  assert.equal(new Set(catalog.map((exercise) => exercise.id)).size, catalog.length);
  for (const exercise of catalog) {
    assert.ok(exercise.nameRu.length <= 80);
    assert.ok(exercise.nameEn.length <= 80);
    assert.ok(exercise.primaryMuscles.length > 0);
    for (const video of exercise.videos ?? []) {
      assert.match(
        video.url,
        /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/u,
        `${exercise.nameRu} needs a direct YouTube URL`,
      );
    }
  }
});
