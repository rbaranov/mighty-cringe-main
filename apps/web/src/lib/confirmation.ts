import type { CurrentUser } from '@mighty-cringe/contracts';

import type { SyncConflict } from './db';

export type ConfirmationStep = {
  title: string;
  message: string;
  confirmLabel: string;
};

export type ConfirmationRequest = {
  steps: readonly [ConfirmationStep, ...ConfirmationStep[]];
  action: () => Promise<void>;
};

export type PendingConfirmation = ConfirmationRequest & {
  stepIndex: number;
};

export type ConfirmationAdvance =
  | { type: 'advance'; confirmation: PendingConfirmation }
  | { type: 'execute'; action: () => Promise<void> };

export type LogoutRisks = {
  pendingMutations: number;
  conflicts: number;
  localVoiceEntries: number;
  pendingVoiceDeletions: number;
};

export function beginConfirmation(request: ConfirmationRequest): PendingConfirmation {
  return { ...request, stepIndex: 0 };
}

export function advanceConfirmation(confirmation: PendingConfirmation): ConfirmationAdvance {
  if (confirmation.stepIndex < confirmation.steps.length - 1) {
    return {
      type: 'advance',
      confirmation: { ...confirmation, stepIndex: confirmation.stepIndex + 1 },
    };
  }
  return { type: 'execute', action: confirmation.action };
}

export function workoutDeletionSteps({
  date,
  locale,
  setCount,
  synced,
}: {
  date: string;
  locale: CurrentUser['locale'];
  setCount: number;
  synced: boolean;
}): [ConfirmationStep, ConfirmationStep] {
  const count = `${setCount} ${setCountLabel(setCount, locale)}`;
  return [
    {
      title: translate(locale, 'Удалить тренировку?', 'Delete this workout?'),
      message: translate(
        locale,
        `${date} · ${count}. Тренировка исчезнет из календаря, истории и расчётов прогресса.`,
        `${date} · ${count}. The workout will disappear from the calendar, history, and progress calculations.`,
      ),
      confirmLabel: translate(locale, 'Продолжить', 'Continue'),
    },
    synced
      ? {
          title: translate(locale, 'Точно удалить тренировку?', 'Remove this workout?'),
          message: translate(
            locale,
            'Тренировка будет помечена удалённой и исчезнет из приложения. Восстановить её через интерфейс сейчас нельзя.',
            'The workout will be marked as deleted and disappear from the app. It cannot currently be restored in the app.',
          ),
          confirmLabel: translate(locale, 'Удалить тренировку', 'Delete workout'),
        }
      : {
          title: translate(locale, 'Удалить единственную копию?', 'Delete the only copy?'),
          message: translate(
            locale,
            `Эта тренировка ещё не сохранилась на сервере. Локальная копия и ${count} будут удалены без возможности восстановления.`,
            `This workout has not been saved to the server yet. The local copy and ${count} will be deleted and cannot be recovered.`,
          ),
          confirmLabel: translate(locale, 'Удалить тренировку', 'Delete workout'),
        },
  ];
}

export function workoutFavoriteRemovalSteps(locale: CurrentUser['locale']): [ConfirmationStep] {
  return [
    {
      title: translate(locale, 'Убрать из избранного?', 'Remove from favorites?'),
      message: translate(
        locale,
        'Тренировка останется в истории и расчётах прогресса. Исчезнет только метка избранного и быстрый доступ на вкладке «Тренировка».',
        'The workout will stay in history and progress calculations. Only its favorite mark and quick access on the Workout tab will be removed.',
      ),
      confirmLabel: translate(locale, 'Убрать из избранного', 'Remove from favorites'),
    },
  ];
}

export function missingServerWorkoutDeletionSteps({
  date,
  locale,
  setCount,
}: {
  date: string;
  locale: CurrentUser['locale'];
  setCount: number;
}): [ConfirmationStep, ConfirmationStep] {
  const count = `${setCount} ${setCountLabel(setCount, locale)}`;
  return [
    {
      title: translate(locale, 'Удалить локальную тренировку?', 'Delete the local workout?'),
      message: translate(
        locale,
        `${date} · ${count}. Сервер уже считает эту тренировку удалённой. Принятие серверной версии удалит оставшуюся в приложении копию.`,
        `${date} · ${count}. The server already considers this workout deleted. Accepting the server version will remove the copy that remains in the app.`,
      ),
      confirmLabel: translate(locale, 'Продолжить', 'Continue'),
    },
    {
      title: translate(locale, 'Удалить оставшуюся копию?', 'Delete the remaining copy?'),
      message: translate(
        locale,
        'Локальная тренировка и её подходы исчезнут с устройства. Восстановление через интерфейс недоступно.',
        'The local workout and its sets will disappear from this device. They cannot be restored in the app.',
      ),
      confirmLabel: translate(locale, 'Удалить локальную тренировку', 'Delete local workout'),
    },
  ];
}

export function conflictNeedsDoubleConfirmation(
  conflict: SyncConflict,
  strategy: 'server' | 'mine',
) {
  return strategy === 'server' && conflict.entityType === 'workout' && conflict.current === null;
}

export function hasLogoutRisks(risks: LogoutRisks) {
  return Object.values(risks).some((count) => count > 0);
}

export function logoutConfirmationSteps(
  risks: LogoutRisks,
  locale: CurrentUser['locale'],
): [ConfirmationStep, ConfirmationStep] {
  const details = logoutRiskLabels(risks, locale).join(locale === 'en' ? '; ' : '; ');
  return [
    {
      title: translate(locale, 'Есть локальные данные', 'Local data is still pending'),
      message: translate(
        locale,
        `При выходе локальная база очищается. Не завершено: ${details}.`,
        `Signing out clears the local database. Still pending: ${details}.`,
      ),
      confirmLabel: translate(locale, 'Продолжить к выходу', 'Continue to sign out'),
    },
    {
      title: translate(locale, 'Выйти и очистить данные?', 'Sign out and clear local data?'),
      message: translate(
        locale,
        'Несинхронизированные изменения и локальные записи нельзя будет восстановить. Уже сохранённые серверные данные останутся в аккаунте.',
        'Unsynced changes and local recordings cannot be recovered. Data already saved on the server will remain in the account.',
      ),
      confirmLabel: translate(
        locale,
        'Выйти и удалить локальные данные',
        'Sign out and delete local data',
      ),
    },
  ];
}

function logoutRiskLabels(risks: LogoutRisks, locale: CurrentUser['locale']) {
  const labels: string[] = [];
  if (risks.pendingMutations) {
    labels.push(
      translate(
        locale,
        `${risks.pendingMutations} ${mutationCountLabel(risks.pendingMutations)}`,
        `${risks.pendingMutations} unsynced ${risks.pendingMutations === 1 ? 'change' : 'changes'}`,
      ),
    );
  }
  if (risks.conflicts) {
    labels.push(
      translate(
        locale,
        `${risks.conflicts} ${conflictCountLabel(risks.conflicts)}`,
        `${risks.conflicts} unresolved ${risks.conflicts === 1 ? 'conflict' : 'conflicts'}`,
      ),
    );
  }
  if (risks.localVoiceEntries) {
    labels.push(
      translate(
        locale,
        `${risks.localVoiceEntries} ${voiceCountLabel(risks.localVoiceEntries)} только на устройстве`,
        `${risks.localVoiceEntries} local ${risks.localVoiceEntries === 1 ? 'recording' : 'recordings'} not uploaded`,
      ),
    );
  }
  if (risks.pendingVoiceDeletions) {
    labels.push(
      translate(
        locale,
        `${risks.pendingVoiceDeletions} ${voiceDeletionCountLabel(risks.pendingVoiceDeletions)}`,
        `${risks.pendingVoiceDeletions} pending voice ${
          risks.pendingVoiceDeletions === 1 ? 'deletion' : 'deletions'
        }`,
      ),
    );
  }
  return labels;
}

function setCountLabel(value: number, locale: CurrentUser['locale']) {
  if (locale === 'en') return value === 1 ? 'set' : 'sets';
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'подходов';
  if (mod10 === 1) return 'подход';
  if (mod10 >= 2 && mod10 <= 4) return 'подхода';
  return 'подходов';
}

function mutationCountLabel(value: number) {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'несинхронизированных изменений';
  if (mod10 === 1) return 'несинхронизированное изменение';
  if (mod10 >= 2 && mod10 <= 4) return 'несинхронизированных изменения';
  return 'несинхронизированных изменений';
}

function conflictCountLabel(value: number) {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'неразрешённых конфликтов';
  if (mod10 === 1) return 'неразрешённый конфликт';
  if (mod10 >= 2 && mod10 <= 4) return 'неразрешённых конфликта';
  return 'неразрешённых конфликтов';
}

function voiceCountLabel(value: number) {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'аудиозаписей';
  if (mod10 === 1) return 'аудиозапись';
  if (mod10 >= 2 && mod10 <= 4) return 'аудиозаписи';
  return 'аудиозаписей';
}

function voiceDeletionCountLabel(value: number) {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'незавершённых удалений аудио';
  if (mod10 === 1) return 'незавершённое удаление аудио';
  if (mod10 >= 2 && mod10 <= 4) return 'незавершённых удаления аудио';
  return 'незавершённых удалений аудио';
}

function translate(locale: CurrentUser['locale'], russian: string, english: string) {
  return locale === 'en' ? english : russian;
}
