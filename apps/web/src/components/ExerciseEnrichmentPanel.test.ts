import { expect, it } from 'vitest';

import type { Exercise, ExerciseDiscoveryCandidate } from '@mighty-cringe/contracts';

import { mergeExerciseDetails } from './ExerciseEnrichmentPanel';

const exercise: Exercise = {
  id: '70000000-0000-4000-8000-000000000010',
  scope: 'user',
  deletedAt: null,
  nameRu: 'махи на заднюю дельту лёжа на боку',
  nameEn: 'махи на заднюю дельту лёжа на боку',
  aliases: [],
  tag: 'normal',
  primaryMuscles: ['rear_delt'],
  secondaryMuscles: [],
  equipment: [],
  videos: [],
  sources: [],
  notes: null,
};

const candidate: ExerciseDiscoveryCandidate = {
  nameRu: 'Отведение руки с гантелью на заднюю дельту лёжа на боку',
  nameEn: 'Side-lying dumbbell rear-delt raise',
  aliases: ['махи на заднюю дельту лёжа на боку'],
  tag: 'normal',
  primaryMuscles: ['rear_delt'],
  secondaryMuscles: ['back'],
  equipment: ['dumbbell'],
  videos: [],
  sources: [{ title: 'Exercise library', url: 'https://example.test/rear-delt-raise' }],
  notes: 'Двигать плечом, сохраняя корпус неподвижным.',
  confidence: 'high',
  matchReason: 'Описание движения и положение совпадают.',
};

it('fills a manual placeholder without deleting athlete-entered details', () => {
  const merged = mergeExerciseDetails(exercise, candidate);

  expect(merged).toMatchObject({
    nameRu: candidate.nameRu,
    nameEn: candidate.nameEn,
    primaryMuscles: ['rear_delt'],
    secondaryMuscles: ['back'],
    equipment: ['dumbbell'],
    notes: candidate.notes,
    sources: candidate.sources,
    videos: [],
  });
  expect(merged.aliases).toContain(candidate.aliases[0]);
});

it('preserves established names and merges new links instead of overwriting them', () => {
  const established: Exercise = {
    ...exercise,
    nameRu: 'Пользовательское название',
    nameEn: 'Athlete name',
    equipment: ['bench'],
    sources: [{ title: 'My source', url: 'https://example.test/mine' }],
  };

  const merged = mergeExerciseDetails(established, candidate);

  expect(merged.nameRu).toBe(established.nameRu);
  expect(merged.nameEn).toBe(established.nameEn);
  expect(merged.equipment).toEqual(['bench', 'dumbbell']);
  expect(merged.sources).toHaveLength(2);
});
