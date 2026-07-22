import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const requiredKeys = [
  'DOMAIN',
  'WEB_ORIGIN',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
];

const voiceStorageKeys = [
  'VOICE_S3_ENDPOINT',
  'VOICE_S3_REGION',
  'VOICE_S3_BUCKET',
  'VOICE_S3_ACCESS_KEY_ID',
  'VOICE_S3_SECRET_ACCESS_KEY',
  'VOICE_S3_ENCRYPTION_KEY',
];
const vapidKeys = ['VAPID_SUBJECT', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'];
const backupKeys = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'RESTIC_PASSWORD',
];

export function parseEnvironment(contents) {
  const environment = {};
  for (const [index, rawLine] of contents.split(/\r?\n/u).entries()) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trimStart();

    const separator = line.indexOf('=');
    const key = separator === -1 ? '' : line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      throw new Error(`Invalid production environment entry on line ${index + 1}`);
    }

    environment[key] = parseValue(line.slice(separator + 1));
  }
  return environment;
}

function parseValue(rawValue) {
  const value = rawValue.trim();
  if (!value) return '';
  const quote = value[0];
  if (quote === "'" || quote === '"') {
    if (value.at(-1) !== quote) throw new Error('Unterminated quoted environment value');
    return value.slice(1, -1);
  }
  const comment = value.search(/\s#/u);
  return (comment === -1 ? value : value.slice(0, comment)).trimEnd();
}

export function validateProductionEnvironment(environment) {
  const missingRequired = requiredKeys.filter((key) => !present(environment, key));
  if (missingRequired.length) {
    throw new Error(`Missing required production settings: ${missingRequired.join(', ')}`);
  }

  validatePostgresPassword(environment.POSTGRES_PASSWORD);

  const origin = parseHttpsUrl(environment.WEB_ORIGIN, 'WEB_ORIGIN');
  if (origin.hostname !== environment.DOMAIN.trim()) {
    throw new Error('WEB_ORIGIN hostname must match DOMAIN');
  }

  const storage = groupState(environment, voiceStorageKeys);
  const openRouterKey = present(environment, 'OPENROUTER_API_KEY');
  const sttModel = present(environment, 'OPENROUTER_STT_MODEL');
  const discoveryModel = present(environment, 'EXERCISE_DISCOVERY_MODEL');
  requireCompleteGroup('voice storage', storage);
  if ((sttModel || discoveryModel) && !openRouterKey) {
    throw new Error('OPENROUTER_API_KEY is required by configured OpenRouter models');
  }
  if (openRouterKey && !sttModel && !discoveryModel) {
    throw new Error('OPENROUTER_API_KEY requires OPENROUTER_STT_MODEL or EXERCISE_DISCOVERY_MODEL');
  }
  if (storage.enabled !== sttModel) {
    throw new Error(
      'Voice storage and OpenRouter transcription must be configured together or both left empty',
    );
  }
  if (storage.enabled && !validEncryptionKey(environment.VOICE_S3_ENCRYPTION_KEY)) {
    throw new Error('VOICE_S3_ENCRYPTION_KEY must be exactly 32 bytes encoded as base64');
  }

  const vapid = groupState(environment, vapidKeys);
  requireCompleteGroup('Web Push VAPID', vapid);
  if (vapid.enabled && !/^(?:mailto:|https:\/\/)/u.test(environment.VAPID_SUBJECT.trim())) {
    throw new Error('VAPID_SUBJECT must start with mailto: or https://');
  }

  const backup = groupState(environment, backupKeys);
  requireCompleteGroup('encrypted backup', backup);
  if (backup.enabled) {
    parseHttpsUrl(environment.S3_ENDPOINT, 'S3_ENDPOINT');
    if (environment.RESTIC_PASSWORD.trim().length < 32) {
      throw new Error('RESTIC_PASSWORD must contain at least 32 characters');
    }
    validatePositiveInteger(environment, 'BACKUP_KEEP_DAILY');
    validatePositiveInteger(environment, 'BACKUP_KEEP_WEEKLY');
    validatePositiveInteger(environment, 'BACKUP_KEEP_MONTHLY');
    validatePercentage(environment, 'RESTIC_CHECK_SUBSET');
  }

  const monitoringEnabled = present(environment, 'HEALTHCHECKS_PING_URL');
  if (monitoringEnabled) {
    if (!backup.enabled) {
      throw new Error('Production monitoring requires encrypted backups to be configured');
    }
    parseHttpsUrl(environment.HEALTHCHECKS_PING_URL, 'HEALTHCHECKS_PING_URL');
    validatePositiveInteger(environment, 'MONITOR_DISK_CRITICAL_PERCENT');
    validatePositiveInteger(environment, 'MONITOR_BACKUP_MAX_AGE_SECONDS');
    validatePositiveInteger(environment, 'MONITOR_RESTORE_MAX_AGE_SECONDS');
    const diskThreshold = Number(environment.MONITOR_DISK_CRITICAL_PERCENT ?? 90);
    if (diskThreshold > 100) {
      throw new Error('MONITOR_DISK_CRITICAL_PERCENT must be at most 100');
    }
  }

  return {
    backupEnabled: backup.enabled,
    monitoringEnabled,
    pushEnabled: vapid.enabled,
    voiceEnabled: storage.enabled,
    exerciseDiscoveryEnabled: discoveryModel,
  };
}

function present(environment, key) {
  return typeof environment[key] === 'string' && environment[key].trim().length > 0;
}

function groupState(environment, keys) {
  const configured = keys.filter((key) => present(environment, key));
  return {
    enabled: configured.length > 0,
    missing: configured.length === 0 ? [] : keys.filter((key) => !configured.includes(key)),
  };
}

function requireCompleteGroup(name, state) {
  if (state.missing.length) {
    throw new Error(`Incomplete ${name} settings; missing: ${state.missing.join(', ')}`);
  }
}

function validEncryptionKey(value) {
  if (!/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/u.test(value.trim())) return false;
  return Buffer.from(value.trim(), 'base64').length === 32;
}

function validatePostgresPassword(value) {
  const password = value.trim();
  if (
    /^<[^>]+>$/u.test(password) ||
    /^(?:change-?me|placeholder|replace(?:-with)?)/iu.test(password)
  ) {
    throw new Error('POSTGRES_PASSWORD must not contain an example placeholder');
  }
  if (password.length < 32) {
    throw new Error('POSTGRES_PASSWORD must contain at least 32 characters');
  }
  if (!/^[A-Za-z0-9._~-]+$/u.test(password)) {
    throw new Error('POSTGRES_PASSWORD must be URL-safe because it is embedded in DATABASE_URL');
  }
}

function parseHttpsUrl(value, key) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${key} must be a valid URL`);
  }
  if (url.protocol !== 'https:') throw new Error(`${key} must use https`);
  return url;
}

function validatePositiveInteger(environment, key) {
  const value = environment[key]?.trim();
  if (value === undefined || value === '') return;
  if (!/^[1-9][0-9]*$/u.test(value)) throw new Error(`${key} must be a positive integer`);
}

function validatePercentage(environment, key) {
  const value = environment[key]?.trim();
  if (value === undefined || value === '') return;
  const match = /^([1-9][0-9]?|100)%$/u.exec(value);
  if (!match) throw new Error(`${key} must be a percentage from 1% to 100%`);
}

async function main(path) {
  if (!path) throw new Error('Usage: node scripts/check-production-env.mjs <environment-file>');
  const environment = parseEnvironment(await readFile(path, 'utf8'));
  const result = validateProductionEnvironment(environment);
  console.log(
    `Production environment verified; backup ${result.backupEnabled ? 'enabled' : 'disabled'}; monitoring ${result.monitoringEnabled ? 'enabled' : 'disabled'}; voice ${result.voiceEnabled ? 'enabled' : 'disabled'}; exercise discovery ${result.exerciseDiscoveryEnabled ? 'enabled' : 'disabled'}; push ${result.pushEnabled ? 'enabled' : 'disabled'}.`,
  );
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `backup_enabled=${String(result.backupEnabled)}\nmonitoring_enabled=${String(result.monitoringEnabled)}\n`,
      'utf8',
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Production environment validation failed',
    );
    process.exitCode = 1;
  });
}
