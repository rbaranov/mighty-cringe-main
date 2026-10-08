import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PostgresRepository } from '../apps/api/dist/repository.js';
import { createWorkoutSchema, createSetSchema } from '../packages/contracts/dist/index.js';

function syntheticWorkouts(now, exerciseIds) {
  return [4, 2, 0].map((daysAgo) => {
    const startedAt = new Date(now.getTime() - daysAgo * 86_400_000 - 1_800_000).toISOString();
    const workout = createWorkoutSchema.parse({
      id: randomUUID(),
      clientMutationId: randomUUID(),
      startedAt,
      endedAt: daysAgo ? new Date(new Date(startedAt).getTime() + 1_800_000).toISOString() : null,
      durationSeconds: daysAgo ? 1800 : 0,
      completionReason: daysAgo ? 'manual' : null,
      isFavorite: daysAgo === 2,
      favoriteName: daysAgo === 2 ? 'База · тест' : null,
      // Plan item IDs are globally unique, including across different workouts.
      exercises: exerciseIds.map((exerciseId, position) => ({
        id: randomUUID(),
        exerciseId,
        position,
        supersetGroup: null,
      })),
    });
    const sets = exerciseIds.map((exerciseId) =>
      createSetSchema.parse({
        clientMutationId: randomUUID(),
        workoutId: workout.id,
        set: {
          id: randomUUID(),
          exerciseId,
          weightKg: 20,
          reps: 10,
          rir: 2,
          comment: 'Синтетические данные для проверки',
          performedAt: startedAt,
          position: 0,
        },
      }),
    );
    return { workout, sets };
  });
}

// Validate the seed contracts without connecting to a database or opening a port.
if (process.argv.includes('--check')) {
  const fixtures = syntheticWorkouts(new Date(), [randomUUID(), randomUUID(), randomUUID()]);
  const ids = fixtures.flatMap(({ workout }) => workout.exercises.map((exercise) => exercise.id));
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate fixture plan IDs');
  process.stdout.write(
    'Trainer acceptance seed contracts and plan IDs are valid. No database or server started.\n',
  );
  process.exit(0);
}

if (process.env.NODE_ENV === 'production') {
  throw new Error('The trainer acceptance helper only runs in a local development environment');
}

// Deliberately fixed to the local development database: never inherit DATABASE_URL.
const repository = new PostgresRepository(
  'postgresql://mightycringe:local-development@127.0.0.1:55432/mightycringe_local',
);
const hash = (token) => createHash('sha256').update(token).digest('hex');
await repository.initialize();
const coach = await repository.upsertGoogleUser(
  {
    subject: 'trainer-acceptance-coach',
    email: 'trainer-acceptance@mightycringe.test',
    displayName: 'Тестовый тренер',
    avatarUrl: null,
  },
  'trainer',
);
const athlete = await repository.upsertGoogleUser(
  {
    subject: 'trainer-acceptance-athlete',
    email: 'athlete-acceptance@mightycringe.test',
    displayName: 'Дмитрий Иванов (тест)',
    avatarUrl: null,
  },
  'athlete',
);
const now = new Date();
const relationship = await repository.getAthleteTrainer(athlete.id);
if (relationship && relationship.id !== coach.id) {
  await repository.close();
  throw new Error('The synthetic athlete is already linked to a different coach');
}
if (!relationship) {
  const token = randomBytes(32).toString('base64url');
  await repository.createTrainerInvite(
    {
      id: randomUUID(),
      trainerId: coach.id,
      email: athlete.email,
      tokenHash: hash(token),
      expiresAt: new Date(now.getTime() + 86_400_000),
    },
    now,
  );
  await repository.acceptTrainerInvite(hash(token), athlete.id, athlete.email, now);
}
// Re-running preserves existing journals. An accepted invitation grants journal access immediately.
if (!(await repository.listWorkouts(athlete.id)).length) {
  const exerciseIds = (await repository.listExercises(athlete.id))
    .filter((exercise) => exercise.scope === 'global' && !exercise.deletedAt)
    .slice(0, 3)
    .map((exercise) => exercise.id);
  for (const fixture of syntheticWorkouts(now, exerciseIds)) {
    await repository.createWorkout(athlete.id, fixture.workout);
    for (const set of fixture.sets) await repository.createSet(athlete.id, set);
  }
}

const server = createServer(async (request, response) => {
  const host = request.headers.host?.split(':')[0];
  if (!['localhost', '127.0.0.1'].includes(host)) {
    response.writeHead(403).end();
    return;
  }
  if (request.method !== 'GET') {
    response.writeHead(405, { Allow: 'GET' }).end();
    return;
  }
  if (!['/coach', '/athlete'].includes(request.url)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const user = request.url === '/coach' ? coach : athlete;
    const token = randomBytes(32).toString('base64url');
    await repository.createSession({
      id: randomUUID(),
      tokenHash: hash(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    });
    response
      .writeHead(302, {
        // Host-only cookies keep localhost coach and 127.0.0.1 athlete sessions separate.
        'Set-Cookie': `mc_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800`,
        Location: `http://${host}:5173/`,
        'Cache-Control': 'no-store',
      })
      .end();
  } catch {
    response.writeHead(500).end('Local acceptance login failed');
  }
});
server.on('error', async (error) => {
  process.stderr.write(`Local acceptance server failed: ${error.message}\n`);
  await repository.close();
  process.exitCode = 1;
});
server.listen(3011, '127.0.0.1', () => {
  process.stdout.write(
    'Тренер: http://localhost:3011/coach\nПодопечный: http://127.0.0.1:3011/athlete\nТолько локальные тестовые аккаунты. Ctrl+C закрывает вход.\n',
  );
});
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    server.close(() => void repository.close().then(() => process.exit(0)));
  });
