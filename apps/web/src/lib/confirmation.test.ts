import { describe, expect, it, vi } from 'vitest';

import type { SyncConflict } from './db';
import {
  advanceConfirmation,
  beginConfirmation,
  conflictNeedsDoubleConfirmation,
  hasLogoutRisks,
  logoutConfirmationSteps,
  missingServerWorkoutDeletionSteps,
  workoutDeletionSteps,
} from './confirmation';

describe('confirmation flow', () => {
  it('advances without executing and exposes the action only after the final step', async () => {
    const action = vi.fn(async () => {});
    const confirmation = beginConfirmation({
      steps: [
        { title: 'First', message: 'Review', confirmLabel: 'Continue' },
        { title: 'Second', message: 'Final warning', confirmLabel: 'Delete' },
      ],
      action,
    });

    const firstResult = advanceConfirmation(confirmation);
    expect(firstResult.type).toBe('advance');
    expect(action).not.toHaveBeenCalled();
    if (firstResult.type !== 'advance') throw new Error('Expected another confirmation step');

    const secondResult = advanceConfirmation(firstResult.confirmation);
    expect(secondResult.type).toBe('execute');
    expect(action).not.toHaveBeenCalled();
    if (secondResult.type !== 'execute') throw new Error('Expected the final action');

    await secondResult.action();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('keeps one-step confirmations on their existing direct path', () => {
    const result = advanceConfirmation(
      beginConfirmation({
        steps: [{ title: 'Delete set?', message: 'One set', confirmLabel: 'Delete set' }],
        action: async () => {},
      }),
    );

    expect(result.type).toBe('execute');
  });
});

describe('workout deletion confirmations', () => {
  it('explains soft deletion for a synchronized workout in Russian', () => {
    const steps = workoutDeletionSteps({
      date: '29 июля 2026 г. в 18:30',
      locale: 'ru',
      setCount: 12,
      synced: true,
    });

    expect(steps[0].message).toContain('12 подходов');
    expect(steps[0].confirmLabel).toBe('Продолжить');
    expect(steps[1].message).toContain('будет помечена удалённой');
    expect(steps[1].message).toContain('Восстановить её через интерфейс сейчас нельзя');
    expect(steps[1].message).not.toContain('без возможности восстановления');
  });

  it('explains soft deletion for a synchronized workout in English', () => {
    const steps = workoutDeletionSteps({
      date: 'July 29, 2026 at 6:30 PM',
      locale: 'en',
      setCount: 2,
      synced: true,
    });

    expect(steps[0].message).toContain('2 sets');
    expect(steps[0].confirmLabel).toBe('Continue');
    expect(steps[1].message).toContain('will be marked as deleted');
    expect(steps[1].message).toContain('cannot currently be restored in the app');
  });

  it('warns that an unsynchronized workout has only a local copy in Russian', () => {
    const steps = workoutDeletionSteps({
      date: '29 июля 2026 г. в 18:30',
      locale: 'ru',
      setCount: 3,
      synced: false,
    });

    expect(steps[0].message).toContain('3 подхода');
    expect(steps[1].title).toBe('Удалить единственную копию?');
    expect(steps[1].message).toContain('ещё не сохранилась на сервере');
    expect(steps[1].message).toContain('без возможности восстановления');
  });

  it('warns that an unsynchronized workout has only a local copy in English', () => {
    const steps = workoutDeletionSteps({
      date: 'July 29, 2026 at 6:30 PM',
      locale: 'en',
      setCount: 1,
      synced: false,
    });

    expect(steps[0].message).toContain('1 set');
    expect(steps[1].title).toBe('Delete the only copy?');
    expect(steps[1].message).toContain('has not been saved to the server yet');
    expect(steps[1].message).toContain('cannot be recovered');
  });

  it('uses a dedicated double confirmation when the server has no active workout copy', () => {
    const conflict = workoutConflict(null);
    const steps = missingServerWorkoutDeletionSteps({
      date: '29 июля 2026 г. в 18:30',
      locale: 'ru',
      setCount: 3,
    });

    expect(conflictNeedsDoubleConfirmation(conflict, 'server')).toBe(true);
    expect(conflictNeedsDoubleConfirmation(conflict, 'mine')).toBe(false);
    expect(conflictNeedsDoubleConfirmation(workoutConflict(serverWorkout()), 'server')).toBe(false);
    expect(steps[0].message).toContain('Сервер уже считает эту тренировку удалённой');
    expect(steps[1].confirmLabel).toBe('Удалить локальную тренировку');
  });
});

describe('risky logout confirmations', () => {
  it('does not interrupt a fully synchronized logout', () => {
    expect(
      hasLogoutRisks({
        pendingMutations: 0,
        conflicts: 0,
        localVoiceEntries: 0,
        pendingVoiceDeletions: 0,
      }),
    ).toBe(false);
  });

  it('lists unsynchronized data and pending voice deletion in both languages', () => {
    const risks = {
      pendingMutations: 2,
      conflicts: 1,
      localVoiceEntries: 1,
      pendingVoiceDeletions: 1,
    };

    expect(hasLogoutRisks(risks)).toBe(true);
    const russian = logoutConfirmationSteps(risks, 'ru');
    const english = logoutConfirmationSteps(risks, 'en');
    expect(russian[0].message).toContain('2 несинхронизированных изменения');
    expect(russian[0].message).toContain('1 неразрешённый конфликт');
    expect(russian[0].message).toContain('1 аудиозапись только на устройстве');
    expect(russian[0].message).toContain('1 незавершённое удаление аудио');
    expect(english[1].confirmLabel).toBe('Sign out and delete local data');
  });
});

function workoutConflict(current: SyncConflict['current']): SyncConflict {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    entityType: 'workout',
    entityId: '20000000-0000-4000-8000-000000000001',
    createdAt: '2026-07-29T12:00:00.000Z',
    message: 'revision conflict',
    mutation: {
      type: 'workout.update',
      payload: {
        clientMutationId: '30000000-0000-4000-8000-000000000001',
        workoutId: '20000000-0000-4000-8000-000000000001',
        baseRevision: 1,
        changes: { notes: 'local' },
      },
    },
    current,
  };
}

function serverWorkout(): NonNullable<SyncConflict['current']> {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    startedAt: '2026-07-29T10:00:00.000Z',
    endedAt: '2026-07-29T11:00:00.000Z',
    notes: null,
    locale: 'ru',
    exercises: [],
    sets: [],
    revision: 2,
    updatedAt: '2026-07-29T11:00:00.000Z',
  };
}
