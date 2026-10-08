import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { configureProductionMonitoring } from './configure-production-monitoring.mjs';

const pingUrl = 'https://hc-ping.com/11111111-2222-4333-8444-555555555555';
const core = `# Keep the server's configuration intact
DOMAIN=mightycringe.com
WEB_ORIGIN=https://mightycringe.com
POSTGRES_DB=mightycringe
POSTGRES_USER=mightycringe
POSTGRES_PASSWORD=${'a'.repeat(64)}
GOOGLE_CLIENT_ID=client-id
GOOGLE_CLIENT_SECRET=oauth-secret
`;
const backups = `S3_ENDPOINT=https://hel1.your-objectstorage.com
S3_REGION=hel1
S3_BUCKET=private-backups
S3_ACCESS_KEY=backup-access-key
S3_SECRET_KEY=backup-secret-key
RESTIC_PASSWORD=${'b'.repeat(32)}
`;

async function fixture(t, contents = core + backups) {
  const directory = await mkdtemp(join(tmpdir(), 'mighty-monitoring-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'production.env');
  await writeFile(path, contents, { mode: 0o600 });
  return { directory, path };
}

test('absent GitHub secret leaves existing configuration untouched', async (t) => {
  const contents = `${core}${backups}HEALTHCHECKS_PING_URL=${pingUrl}\n`;
  const { path } = await fixture(t, contents);
  assert.equal(await configureProductionMonitoring(path, ''), false);
  assert.equal(await readFile(path, 'utf8'), contents);
  assert.equal(await configureProductionMonitoring('/does-not-exist', undefined), false);
});

test('installs only the ping URL atomically with private permissions and is idempotent', async (t) => {
  const { directory, path } = await fixture(t);
  await configureProductionMonitoring(path, pingUrl);
  assert.equal(await readFile(path, 'utf8'), `${core}${backups}HEALTHCHECKS_PING_URL=${pingUrl}\n`);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(directory), ['production.env']);
  assert.equal(await configureProductionMonitoring(path, pingUrl), false);
});

test('replaces all existing URL assignments, preserving other secrets and thresholds', async (t) => {
  const retained = `${core}${backups}MONITOR_DISK_CRITICAL_PERCENT=85\n`;
  const { path } = await fixture(
    t,
    `${retained}HEALTHCHECKS_PING_URL=old\nexport HEALTHCHECKS_PING_URL = 'other'\n`,
  );
  await configureProductionMonitoring(path, pingUrl);
  assert.equal(await readFile(path, 'utf8'), `${retained}HEALTHCHECKS_PING_URL=${pingUrl}\n`);
});

test('invalid secrets and incomplete backups cannot change the production file', async (t) => {
  const { directory, path } = await fixture(t, core);
  for (const value of [pingUrl, `${pingUrl}\nOTHER=bad`, 'https://example.com/secret']) {
    await assert.rejects(configureProductionMonitoring(path, value));
    assert.equal(await readFile(path, 'utf8'), core);
    assert.deepEqual(await readdir(directory), ['production.env']);
  }
});

test('rejects symlinks and does not expose credentials in CLI failure output', async (t) => {
  const { directory, path } = await fixture(t);
  const link = join(directory, 'link.env');
  await symlink(path, link);
  await assert.rejects(configureProductionMonitoring(link, pingUrl), /regular file/u);
  const result = spawnSync(
    process.execPath,
    ['scripts/configure-production-monitoring.mjs', path],
    {
      env: { ...process.env, HEALTHCHECKS_PING_URL: `${pingUrl}\nOTHER=private-value` },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 1);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /11111111|private-value|oauth-secret|backup-secret-key/u,
  );
  assert.equal(await readFile(path, 'utf8'), core + backups);
});
