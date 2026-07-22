import assert from 'node:assert/strict';
import test from 'node:test';

import type { ExerciseDiscoveryCandidate } from '@mighty-cringe/contracts';

import { buildApp } from './app.js';
import {
  OpenRouterExerciseDiscovery,
  exerciseDiscoveryFromEnvironment,
  type ExerciseDiscovery,
} from './exerciseDiscovery.js';
import { MemoryRepository, RepositoryConflictError } from './repository.js';

const candidate: ExerciseDiscoveryCandidate = {
  nameRu: 'Тяга гантели одной рукой',
  nameEn: 'One-arm dumbbell row',
  aliases: ['тяга Арни'],
  tag: 'normal',
  primaryMuscles: ['back'],
  secondaryMuscles: ['biceps', 'rear_delt'],
  equipment: ['dumbbell', 'bench'],
  videos: [
    { title: 'Technique', url: 'https://www.youtube.com/watch?v=abc123DEF45' },
    { title: 'Not a video host', url: 'https://example.test/not-video' },
  ],
  sources: [
    { title: 'Model title', url: 'https://example.test/row' },
    { title: 'Invented', url: 'https://invented.example.test/row' },
  ],
  notes: 'Keep the torso stable.',
  confidence: 'medium',
  matchReason: 'One plausible interpretation of the informal name.',
};

test('OpenRouter discovery keeps only web-cited sources and cited YouTube videos', async () => {
  const discovery = new OpenRouterExerciseDiscovery(
    'secret',
    'provider/model',
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ candidates: [candidate] }),
                annotations: [
                  {
                    type: 'url_citation',
                    url_citation: { url: 'https://example.test/row', title: 'Verified row source' },
                  },
                  {
                    type: 'url_citation',
                    url_citation: {
                      url: 'https://www.youtube.com/watch?v=abc123DEF45',
                      title: 'Verified technique video',
                    },
                  },
                  {
                    type: 'url_citation',
                    url_citation: { url: 'https://example.test/not-video', title: 'Article' },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );

  const result = await discovery.discover('тяга арни', 'ru');

  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].sources, [
    { title: 'Verified row source', url: 'https://example.test/row' },
  ]);
  assert.deepEqual(result.candidates[0].videos, [
    { title: 'Technique', url: 'https://www.youtube.com/watch?v=abc123DEF45' },
  ]);
  assert.ok(result.candidates[0].aliases.includes('тяга арни'));
});

test('environment enables exercise discovery only with a key and model', () => {
  assert.equal(exerciseDiscoveryFromEnvironment({}), null);
  assert.equal(
    exerciseDiscoveryFromEnvironment({ OPENROUTER_API_KEY: 'secret' } as NodeJS.ProcessEnv),
    null,
  );
  assert.ok(
    exerciseDiscoveryFromEnvironment({
      OPENROUTER_API_KEY: 'secret',
      EXERCISE_DISCOVERY_MODEL: 'provider/model',
    } as NodeJS.ProcessEnv),
  );
});

test('API discovers, confirms and stores an exercise in the current user catalog', async () => {
  const repository = new MemoryRepository();
  const developmentUser = await repository.upsertGoogleUser(
    {
      subject: 'exercise-owner',
      email: 'owner@example.test',
      displayName: 'Owner',
      avatarUrl: null,
    },
    'athlete',
  );
  const exerciseDiscovery: ExerciseDiscovery = {
    async discover(query) {
      return { query, candidates: [candidate] };
    },
  };
  const app = buildApp(repository, { developmentUser, exerciseDiscovery });
  await app.ready();

  const found = await app.inject({
    method: 'POST',
    url: '/api/v1/exercises/discover',
    payload: { query: 'тяга арни', locale: 'ru' },
  });
  assert.equal(found.statusCode, 200);
  assert.equal(found.json().candidates.length, 1);

  const exerciseId = '70000000-0000-4000-8000-000000000001';
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/exercises',
    payload: {
      id: exerciseId,
      ...candidate,
      confidence: undefined,
      matchReason: undefined,
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().exercise.scope, 'user');

  const catalog = await app.inject({ method: 'GET', url: '/api/v1/exercises' });
  assert.equal(catalog.statusCode, 200);
  assert.ok(catalog.json().items.some((exercise: { id: string }) => exercise.id === exerciseId));

  await app.close();
});

test('personal exercises are isolated by owner and ids cannot be claimed by another user', async () => {
  const repository = new MemoryRepository();
  const input = {
    id: '70000000-0000-4000-8000-000000000002',
    nameRu: candidate.nameRu,
    nameEn: candidate.nameEn,
    aliases: candidate.aliases,
    tag: candidate.tag,
    primaryMuscles: candidate.primaryMuscles,
    secondaryMuscles: candidate.secondaryMuscles,
    equipment: candidate.equipment,
    videos: candidate.videos,
    sources: candidate.sources,
    notes: candidate.notes,
  };

  await repository.createExercise('70000000-0000-4000-8000-000000000010', input);
  assert.ok(
    (await repository.listExercises('70000000-0000-4000-8000-000000000010')).some(
      (exercise) => exercise.id === input.id,
    ),
  );
  assert.ok(
    !(await repository.listExercises('70000000-0000-4000-8000-000000000011')).some(
      (exercise) => exercise.id === input.id,
    ),
  );
  await assert.rejects(
    repository.createExercise('70000000-0000-4000-8000-000000000011', input),
    RepositoryConflictError,
  );
});
