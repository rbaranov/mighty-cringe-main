import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
const [index, serviceWorker, manifestText] = await Promise.all([
  readFile(new URL('index.html', dist), 'utf8'),
  readFile(new URL('sw.js', dist), 'utf8'),
  readFile(new URL('manifest.webmanifest', dist), 'utf8'),
]);
const manifest = JSON.parse(manifestText);

assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.scope, '/');
assert.match(index, /rel="manifest" href="\/manifest\.webmanifest"/);
assert.equal(index.match(/registerSW\.js/g)?.length, 1, 'service worker must register once');
assert.match(serviceWorker, /precacheAndRoute/);
assert.match(serviceWorker, /createHandlerBoundToURL\("\/?index\.html"\)/);
assert.match(serviceWorker, /NavigationRoute/);

const shellAssets = [...index.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
  (match) => match[1],
);
assert.ok(shellAssets.length >= 2, 'built HTML must reference its JS and CSS shell');
for (const asset of shellAssets) {
  assert.ok(
    serviceWorker.includes(asset.slice(1)),
    `${asset} must be precached for offline launch`,
  );
}

console.log(`PWA offline shell verified: ${shellAssets.length} hashed assets are precached.`);
