import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExerciseDiscoveryCandidate } from '@mighty-cringe/contracts';

import { createPersonalExercise } from './exercises';

const candidate: ExerciseDiscoveryCandidate = {
  nameRu: 'Тяга гантели одной рукой',
  nameEn: 'One-arm dumbbell row',
  aliases: ['тяга Арни'],
  tag: 'normal',
  primaryMuscles: ['back'],
  secondaryMuscles: ['biceps'],
  equipment: ['dumbbell', 'bench'],
  videos: [
    {
      title: 'Техника тяги гантели',
      url: 'https://www.youtube.com/watch?v=abc123DEF45',
    },
  ],
  sources: [{ title: 'Exercise library', url: 'https://example.test/one-arm-row' }],
  notes: 'Держать корпус неподвижно.',
  confidence: 'high',
  matchReason: 'Название и движение подтверждены источниками.',
};

describe('personal exercise creation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the verified video and keeps it in the saved exercise', async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json(
        {
          exercise: {
            id: '70000000-0000-4000-8000-000000000001',
            scope: 'user',
            deletedAt: null,
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
          },
        },
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', request);

    const saved = await createPersonalExercise(candidate);
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as {
      videos?: unknown;
    };

    expect(body.videos).toEqual(candidate.videos);
    expect(saved.videos).toEqual(candidate.videos);
  });
});
