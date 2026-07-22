import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = path.join(repositoryRoot, 'infra', 'local', 'compose.yaml');
const postgresPort = process.env.LOCAL_POSTGRES_PORT?.trim() || '55432';
if (!/^[1-9][0-9]{1,4}$/u.test(postgresPort) || Number(postgresPort) > 65_535) {
  throw new Error('LOCAL_POSTGRES_PORT must be a valid TCP port');
}
const localStateDirectory = path.join(repositoryRoot, '.local');
const nativeDataDirectory = path.join(localStateDirectory, 'postgres');
const nativeLogPath = path.join(localStateDirectory, 'postgres.log');
const databaseUrl = `postgresql://mightycringe:local-development@127.0.0.1:${postgresPort}/mightycringe_local`;
const command = process.argv[2] ?? 'doctor';
const backend = chooseBackend();

const localEnvironment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  LOCAL_DEMO_AUTH: 'true',
  NODE_ENV: 'development',
  PORT: '3000',
  WEB_ORIGIN: 'http://localhost:5173',
};

switch (command) {
  case 'doctor':
    doctor();
    break;
  case 'up':
    startDatabase();
    migrate();
    printReady();
    break;
  case 'dev':
    startDatabase();
    migrate();
    printReady();
    await runDevelopmentServers();
    break;
  case 'status':
    databaseStatus();
    break;
  case 'stop':
    stopDatabase();
    process.stdout.write('Local services stopped. PostgreSQL data was preserved.\n');
    break;
  case 'reset':
    if (!process.argv.includes('--yes')) {
      process.stderr.write(
        'Reset deletes the isolated local PostgreSQL data. Run `pnpm local:reset -- --yes` to confirm.\n',
      );
      process.exitCode = 2;
      break;
    }
    resetDatabase();
    startDatabase();
    migrate();
    process.stdout.write('Local PostgreSQL was reset and migrated.\n');
    break;
  default:
    process.stderr.write(`Unknown local environment command: ${command}\n`);
    process.exitCode = 2;
}

function doctor() {
  const failures = [];
  check(
    'node',
    ['--version'],
    (value) => Number(/^v([0-9]+)/u.exec(value)?.[1] ?? 0) >= 22,
    'Node.js 22+',
  );
  check('pnpm', ['--version'], () => true, 'pnpm');
  if (backend === 'docker') {
    check('docker', ['compose', 'version'], () => true, 'Docker Compose');
  } else if (backend === 'native') {
    check('postgres', ['--version'], supportedPostgres, 'PostgreSQL 16+');
    check('initdb', ['--version'], supportedPostgres, 'initdb 16+');
    check('pg_ctl', ['--version'], supportedPostgres, 'pg_ctl 16+');
    check('psql', ['--version'], supportedPostgres, 'psql 16+');
    check('createdb', ['--version'], supportedPostgres, 'createdb 16+');
  } else {
    failures.push('Docker Compose or native PostgreSQL 16+ is required');
  }
  if (failures.length) {
    process.stderr.write(`Local environment is not ready:\n- ${failures.join('\n- ')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Local prerequisites are ready (${backend} PostgreSQL). The database will listen only on 127.0.0.1:${postgresPort}.\n`,
  );

  function check(executable, args, validate, label) {
    const result = spawnSync(executable, args, { cwd: repositoryRoot, encoding: 'utf8' });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    if (result.status !== 0 || !validate(output))
      failures.push(`${label} is missing or unsupported`);
    else process.stdout.write(`✓ ${label}: ${output.split(/\r?\n/u)[0]}\n`);
  }
}

function startDatabase() {
  if (backend === 'docker') {
    run('docker', composeArguments('up', '-d', '--wait', 'postgres'));
    return;
  }
  requireBackend();
  fs.mkdirSync(localStateDirectory, { recursive: true });
  if (!fs.existsSync(path.join(nativeDataDirectory, 'PG_VERSION'))) {
    run('initdb', [
      '--pgdata',
      nativeDataDirectory,
      '--username',
      'mightycringe',
      '--auth',
      'trust',
      '--encoding',
      'UTF8',
      '--no-locale',
    ]);
  }
  if (!nativeDatabaseRunning()) {
    run('pg_ctl', [
      '--pgdata',
      nativeDataDirectory,
      '--log',
      nativeLogPath,
      '--options',
      `-p ${postgresPort} -h 127.0.0.1`,
      '--wait',
      'start',
    ]);
  }
  const exists = capture('psql', [
    '--host',
    '127.0.0.1',
    '--port',
    postgresPort,
    '--username',
    'mightycringe',
    '--dbname',
    'postgres',
    '--tuples-only',
    '--no-align',
    '--command',
    "SELECT 1 FROM pg_database WHERE datname = 'mightycringe_local'",
  ]);
  if (exists.trim() !== '1') {
    run('createdb', [
      '--host',
      '127.0.0.1',
      '--port',
      postgresPort,
      '--username',
      'mightycringe',
      'mightycringe_local',
    ]);
  }
}

function migrate() {
  run('pnpm', ['--filter', '@mighty-cringe/db', 'db:migrate'], { env: localEnvironment });
}

function printReady() {
  process.stdout.write(
    [
      `Local ${backend} PostgreSQL is healthy and migrated.`,
      'Demo authentication is explicitly enabled for development only.',
      `Database: ${databaseUrl}`,
      '',
    ].join('\n'),
  );
}

async function runDevelopmentServers() {
  const child = spawn('pnpm', ['dev'], {
    cwd: repositoryRoot,
    env: localEnvironment,
    stdio: 'inherit',
  });
  let interrupted = false;
  const forwardInterrupt = () => {
    interrupted = true;
    child.kill('SIGINT');
  };
  const forwardTermination = () => {
    interrupted = true;
    child.kill('SIGTERM');
  };
  process.once('SIGINT', forwardInterrupt);
  process.once('SIGTERM', forwardTermination);
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
  process.removeListener('SIGINT', forwardInterrupt);
  process.removeListener('SIGTERM', forwardTermination);
  process.exitCode = interrupted ? 0 : exitCode;
}

function composeArguments(...args) {
  return ['compose', '--file', composeFile, ...args];
}

function databaseStatus() {
  if (backend === 'docker') run('docker', composeArguments('ps'));
  else if (backend === 'native') {
    if (!fs.existsSync(path.join(nativeDataDirectory, 'PG_VERSION'))) {
      process.stdout.write('Native local PostgreSQL has not been initialized.\n');
      return;
    }
    if (nativeDatabaseRunning()) {
      run('pg_ctl', ['--pgdata', nativeDataDirectory, 'status']);
    } else {
      process.stdout.write('Native local PostgreSQL is stopped; data is preserved.\n');
    }
  } else requireBackend();
}

function stopDatabase() {
  if (backend === 'docker') {
    run('docker', composeArguments('down'));
  } else if (backend === 'native' && nativeDatabaseRunning()) {
    run('pg_ctl', ['--pgdata', nativeDataDirectory, '--wait', '--mode', 'fast', 'stop']);
  } else requireBackend();
}

function resetDatabase() {
  if (backend === 'docker') {
    run('docker', composeArguments('down', '--volumes', '--remove-orphans'));
    return;
  }
  requireBackend();
  if (nativeDatabaseRunning()) {
    run('pg_ctl', ['--pgdata', nativeDataDirectory, '--wait', '--mode', 'fast', 'stop']);
  }
  const expectedParent = path.resolve(repositoryRoot, '.local');
  if (path.dirname(path.resolve(nativeDataDirectory)) !== expectedParent) {
    throw new Error('Refusing to reset an unexpected PostgreSQL data path');
  }
  fs.rmSync(nativeDataDirectory, { recursive: true, force: true });
  fs.rmSync(nativeLogPath, { force: true });
}

function chooseBackend() {
  const requested = process.env.LOCAL_POSTGRES_BACKEND?.trim();
  if (requested && !['docker', 'native'].includes(requested)) {
    throw new Error('LOCAL_POSTGRES_BACKEND must be docker or native');
  }
  if (requested) return requested;
  if (fs.existsSync(path.join(nativeDataDirectory, 'PG_VERSION'))) return 'native';
  if (available('docker', ['compose', 'version'])) return 'docker';
  if (available('postgres', ['--version']) && available('pg_ctl', ['--version'])) return 'native';
  return null;
}

function nativeDatabaseRunning() {
  if (!fs.existsSync(path.join(nativeDataDirectory, 'PG_VERSION'))) return false;
  return (
    spawnSync('pg_ctl', ['--pgdata', nativeDataDirectory, 'status'], {
      cwd: repositoryRoot,
      stdio: 'ignore',
    }).status === 0
  );
}

function supportedPostgres(value) {
  return Number(/([0-9]+)(?:\.[0-9]+)?/u.exec(value)?.[1] ?? 0) >= 16;
}

function available(executable, args) {
  return spawnSync(executable, args, { cwd: repositoryRoot, stdio: 'ignore' }).status === 0;
}

function requireBackend() {
  if (!backend) throw new Error('Docker Compose or native PostgreSQL 16+ is required');
}

function capture(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    env: localEnvironment,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? 'Local database command failed\n');
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? '';
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    env: options.env ?? process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
