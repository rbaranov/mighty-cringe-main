import { expect, it } from 'vitest';

import { inferredMuscle } from './ExerciseAddPanel';

it('recognizes declined Russian delt names in an informal movement description', () => {
  expect(inferredMuscle('лежа на боку махи гантелей на заднюю дельту')).toBe('rear_delt');
  expect(inferredMuscle('отведение руки на среднюю дельту')).toBe('middle_delt');
});
