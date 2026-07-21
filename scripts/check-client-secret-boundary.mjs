import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const roots = ['apps/web/src', 'apps/web/dist'];
const forbidden = [
  'GOOGLE_CLIENT_SECRET',
  'SESSION_SECRET',
  'OPENROUTER_API_KEY',
  'VOICE_S3_SECRET_ACCESS_KEY',
  'VOICE_S3_ENCRYPTION_KEY',
  'RESTIC_PASSWORD',
  'HEALTHCHECKS_PING_URL',
];
const readableExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.ts', '.tsx']);
const findings = [];

async function scan(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      await scan(entryPath);
      continue;
    }
    if (!readableExtensions.has(extname(entry.name))) continue;
    const contents = await readFile(entryPath, 'utf8');
    for (const secretName of forbidden) {
      if (contents.includes(secretName)) findings.push(`${entryPath}: ${secretName}`);
    }
  }
}

for (const root of roots) await scan(root);

if (findings.length) {
  console.error('Server-only secret names crossed the PWA boundary:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log('PWA secret boundary verified.');
}
