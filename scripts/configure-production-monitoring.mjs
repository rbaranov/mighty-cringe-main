import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { parseEnvironment, validateProductionEnvironment } from './check-production-env.mjs';

// This optional bootstrap runs as deploy, before production preflight. It writes only
// the monitoring URL; database, OAuth and backup credentials stay on the server.
export async function configureProductionMonitoring(path, pingUrl) {
  if (!pingUrl) return false;
  if (!/^https:\/\/hc-ping\.com\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(pingUrl)) {
    throw new Error('Monitoring secret must be a Healthchecks.io HTTPS UUID ping URL');
  }
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.uid !== process.getuid()) {
    throw new Error('Production environment must be a regular file owned by the deploy user');
  }
  const original = await readFile(path, 'utf8');
  const retained = original
    .split('\n')
    .filter((line) => !/^\s*(?:export\s+)?HEALTHCHECKS_PING_URL\s*=/u.test(line))
    .join('\n');
  const candidate = `${retained}${retained.endsWith('\n') ? '' : '\n'}HEALTHCHECKS_PING_URL=${pingUrl}\n`;
  // Fail before any write if backups or other production settings are invalid.
  validateProductionEnvironment(parseEnvironment(candidate));
  if (candidate === original && (metadata.mode & 0o777) === 0o600) return false;

  const temporary = `${path}.monitoring-${randomUUID()}`;
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(candidate, 'utf8');
    await file.sync();
    await file.close();
    file = undefined;
    await rename(temporary, path);
  } finally {
    await file?.close();
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  configureProductionMonitoring(process.argv[2], process.env.HEALTHCHECKS_PING_URL)
    .then((changed) => {
      console.log(
        changed ? 'Monitoring configuration installed.' : 'Monitoring configuration unchanged.',
      );
    })
    .catch(() => {
      // Never echo the input secret or production file contents, including on failure.
      console.error(
        'Monitoring configuration failed; check the secret, file permissions and production preflight.',
      );
      process.exitCode = 1;
    });
}
