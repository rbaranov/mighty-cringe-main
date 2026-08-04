import assert from 'node:assert/strict';
import test from 'node:test';

import type { ExerciseDiscoveryCandidate } from '@mighty-cringe/contracts';

import { buildApp } from './app.js';
import {
  OpenRouterExerciseDiscovery,
  exerciseDiscoveryFromEnvironment,
  type ExerciseDiscovery,
  type ExerciseDiscoveryOptions,
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
  const requests: Array<Record<string, unknown>> = [];
  const discovery = new OpenRouterExerciseDiscovery(
    'secret',
    'provider/model',
    async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(request);
      const messages = request.messages as Array<{ content: string }>;
      const structured = request.response_format !== undefined;
      const videoSearch = messages[0].content.includes('dedicated video-research');
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: structured
                  ? JSON.stringify({ candidates: [{ ...candidate, isExercise: true }] })
                  : videoSearch
                    ? 'Grounded technique video research.'
                    : 'Grounded exercise research with citations.',
                annotations: structured
                  ? []
                  : videoSearch
                    ? [
                        {
                          type: 'url_citation',
                          url_citation: {
                            url: 'https://www.youtube.com/watch?v=abc123DEF45',
                            title: 'Verified technique video',
                          },
                        },
                      ]
                    : [
                        {
                          type: 'url_citation',
                          url_citation: {
                            url: 'https://example.test/row',
                            title: 'Verified row source',
                          },
                        },
                        {
                          type: 'url_citation',
                          url_citation: {
                            url: 'https://example.test/not-video',
                            title: 'Article',
                          },
                        },
                      ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
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
  assert.equal(requests.length, 3);
  const researchRequest = requests.find(
    (request) =>
      request.response_format === undefined &&
      !(request.messages as Array<{ content: string }>)[0].content.includes(
        'dedicated video-research',
      ),
  );
  const videoRequest = requests.find((request) =>
    (request.messages as Array<{ content: string }>)[0].content.includes(
      'dedicated video-research',
    ),
  );
  const structuredRequest = requests.find((request) => request.response_format !== undefined);
  assert.deepEqual(researchRequest?.provider, { zdr: true });
  assert.deepEqual(researchRequest?.tools, [
    {
      type: 'openrouter:web_search',
      parameters: { engine: 'exa', max_results: 5 },
    },
  ]);
  assert.deepEqual(videoRequest?.tools, [
    {
      type: 'openrouter:web_search',
      parameters: { engine: 'exa', max_results: 8 },
    },
  ]);
  assert.deepEqual(structuredRequest?.provider, { zdr: true, require_parameters: true });
  assert.equal(structuredRequest?.tools, undefined);
  assert.equal(
    (structuredRequest?.response_format as { json_schema?: { strict?: boolean } }).json_schema
      ?.strict,
    true,
  );
  const evidenceRequest = structuredRequest?.messages as Array<{ content: string }>;
  assert.match(evidenceRequest[1].content, /https:\/\/example\.test\/row/u);
  assert.match(evidenceRequest[1].content, /https:\/\/www\.youtube\.com\/watch/u);
  assert.doesNotMatch(evidenceRequest[1].content, /invented\.example/u);
});

test('does not synthesize a candidate when web search returns no citations', async () => {
  let requests = 0;
  const discovery = new OpenRouterExerciseDiscovery('secret', 'provider/model', async () => {
    requests += 1;
    return Response.json({ choices: [{ message: { content: 'No reliable result.' } }] });
  });

  const result = await discovery.discover('unknown movement', 'en');

  assert.deepEqual(result, { query: 'unknown movement', candidates: [] });
  assert.equal(requests, 2);
});

test('offers a grounded exercise even when no cited YouTube video is available', async () => {
  const discovery = new OpenRouterExerciseDiscovery(
    'secret',
    'provider/model',
    async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const messages = request.messages as Array<{ content: string }>;
      if (request.response_format !== undefined) {
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  candidates: [{ ...candidate, isExercise: true }],
                }),
              },
            },
          ],
        });
      }
      const videoSearch = messages[0].content.includes('dedicated video-research');
      return Response.json({
        choices: [
          {
            message: {
              content: videoSearch ? 'No direct video found.' : 'Grounded exercise research.',
              annotations: [
                {
                  type: 'url_citation',
                  url_citation: {
                    url: videoSearch
                      ? 'https://example.test/video-roundup'
                      : 'https://example.test/row',
                    title: videoSearch ? 'Video roundup' : 'Verified row source',
                  },
                },
              ],
            },
          },
        ],
      });
    },
  );

  const result = await discovery.discover('тяга арни', 'ru');

  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].videos, []);
  assert.deepEqual(result.candidates[0].sources, [
    { title: 'Verified row source', url: 'https://example.test/row' },
  ]);
});

test('rejects anatomy as a candidate and reports real discovery phases', async () => {
  const progress: string[] = [];
  const discovery = new OpenRouterExerciseDiscovery(
    'secret',
    'provider/model',
    async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (request.response_format !== undefined) {
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  candidates: [
                    { ...candidate, nameRu: 'Трёхглавая мышца плеча', isExercise: false },
                  ],
                }),
              },
            },
          ],
        });
      }
      return Response.json({
        choices: [
          {
            message: {
              content: 'Grounded research.',
              annotations: [
                {
                  type: 'url_citation',
                  url_citation: { url: 'https://example.test/row', title: 'Source' },
                },
              ],
            },
          },
        ],
      });
    },
  );

  const result = await discovery.discover('разгибатели плеча', 'ru', {
    onProgress: (phase, status) => progress.push(`${phase}:${status}`),
  });

  assert.deepEqual(result.candidates, []);
  assert.ok(progress.includes('information:running'));
  assert.ok(progress.includes('video:running'));
  assert.ok(progress.includes('structuring:running'));
  assert.ok(progress.includes('verification:completed'));
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
  let enrichmentContext: ExerciseDiscoveryOptions['context'];
  const exerciseDiscovery: ExerciseDiscovery = {
    async discover(query, _locale, options) {
      enrichmentContext = options?.context;
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
  assert.deepEqual(created.json().exercise.videos, candidate.videos);

  const ambiguous = await app.inject({
    method: 'POST',
    url: '/api/v1/exercises',
    payload: {
      id: '70000000-0000-4000-8000-000000000099',
      ...candidate,
      nameRu: 'Пуловер',
      nameEn: 'Pullover',
      confidence: undefined,
      matchReason: undefined,
    },
  });
  assert.equal(ambiguous.statusCode, 400);

  const corrected = await app.inject({
    method: 'PUT',
    url: `/api/v1/exercises/${exerciseId}`,
    payload: {
      nameRu: 'Тяга Арнольда',
      nameEn: candidate.nameEn,
      aliases: candidate.aliases,
      tag: candidate.tag,
      primaryMuscles: candidate.primaryMuscles,
      secondaryMuscles: candidate.secondaryMuscles,
      equipment: candidate.equipment,
      videos: candidate.videos,
      sources: candidate.sources,
      notes: candidate.notes,
    },
  });
  assert.equal(corrected.statusCode, 200);
  assert.equal(corrected.json().exercise.nameRu, 'Тяга Арнольда');

  const enrichment = await app.inject({
    method: 'POST',
    url: '/api/v1/exercise-discoveries',
    payload: { query: 'Тяга Арнольда', locale: 'ru', exerciseId },
  });
  assert.equal(enrichment.statusCode, 202);
  assert.equal(enrichmentContext?.nameRu, 'Тяга Арнольда');
  assert.deepEqual(enrichmentContext?.primaryMuscles, candidate.primaryMuscles);

  const globalEdit = await app.inject({
    method: 'PUT',
    url: '/api/v1/exercises/10000000-0000-4000-8000-000000000001',
    payload: corrected.json().exercise,
  });
  assert.equal(globalEdit.statusCode, 404);

  const deleted = await app.inject({
    method: 'DELETE',
    url: `/api/v1/exercises/${exerciseId}`,
  });
  assert.equal(deleted.statusCode, 200);
  assert.ok(deleted.json().exercise.deletedAt);

  const catalog = await app.inject({ method: 'GET', url: '/api/v1/exercises' });
  assert.equal(catalog.statusCode, 200);
  assert.ok(
    catalog
      .json()
      .items.some(
        (exercise: { id: string; deletedAt: string | null }) =>
          exercise.id === exerciseId && exercise.deletedAt,
      ),
  );

  await app.close();
});

test('discovery jobs expose progress and cancel the provider request', async () => {
  const repository = new MemoryRepository();
  const developmentUser = await repository.upsertGoogleUser(
    {
      subject: 'job-owner',
      email: 'job-owner@example.test',
      displayName: 'Job owner',
      avatarUrl: null,
    },
    'athlete',
  );
  let providerAborted = false;
  const exerciseDiscovery: ExerciseDiscovery = {
    async discover(_query, _locale, options) {
      options?.onProgress?.('information', 'running');
      options?.onProgress?.('video', 'running');
      return await new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          providerAborted = true;
          reject(new Error('aborted'));
        });
      });
    },
  };
  const app = buildApp(repository, { developmentUser, exerciseDiscovery });
  await app.ready();

  const started = await app.inject({
    method: 'POST',
    url: '/api/v1/exercise-discoveries',
    payload: { query: 'мах гантелью лёжа на боку', locale: 'ru' },
  });
  assert.equal(started.statusCode, 202);
  const jobId = started.json().job.id as string;

  const progress = await app.inject({
    method: 'GET',
    url: `/api/v1/exercise-discoveries/${jobId}`,
  });
  assert.equal(progress.statusCode, 200);
  assert.equal(progress.json().job.status, 'running');
  assert.equal(
    progress.json().job.phases.find((phase: { phase: string }) => phase.phase === 'video').status,
    'running',
  );

  const cancelled = await app.inject({
    method: 'DELETE',
    url: `/api/v1/exercise-discoveries/${jobId}`,
  });
  assert.equal(cancelled.statusCode, 204);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(providerAborted, true);

  const afterCancel = await app.inject({
    method: 'GET',
    url: `/api/v1/exercise-discoveries/${jobId}`,
  });
  assert.equal(afterCancel.json().job.status, 'cancelled');
  await app.close();
});

test('offline-created exercises synchronize before workout changes', async () => {
  const repository = new MemoryRepository();
  const developmentUser = await repository.upsertGoogleUser(
    {
      subject: 'manual-exercise-owner',
      email: 'manual@example.test',
      displayName: 'Manual owner',
      avatarUrl: null,
    },
    'athlete',
  );
  const app = buildApp(repository, { developmentUser });
  await app.ready();
  const exerciseId = '70000000-0000-4000-8000-000000000077';

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    payload: {
      type: 'exercise.create',
      payload: {
        id: exerciseId,
        clientMutationId: '71000000-0000-4000-8000-000000000077',
        nameRu: 'Отведение руки с гантелью лёжа на боку',
        nameEn: 'Отведение руки с гантелью лёжа на боку',
        aliases: [],
        tag: 'normal',
        primaryMuscles: ['middle_delt'],
        secondaryMuscles: [],
        equipment: [],
        videos: [],
        sources: [],
        notes: null,
      },
    },
  });

  assert.equal(created.statusCode, 201);
  assert.equal(created.json().entityType, 'exercise');
  const catalog = await app.inject({ method: 'GET', url: '/api/v1/exercises' });
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
