import type { CurrentUser, Exercise, UnitSystem } from '@mighty-cringe/contracts';

import { db, type LocalMeasurement, type LocalSet, type LocalWorkout, type SyncState } from './db';

export const localDataExportFormat = 'mighty-cringe.local-data';
export const localDataExportVersion = 1;

type ExportedSet = Omit<LocalSet, 'deleted'>;
type ExportedMeasurement = Omit<LocalMeasurement, 'deleted'>;

export type LocalDataExport = {
  format: typeof localDataExportFormat;
  formatVersion: typeof localDataExportVersion;
  exportedAt: string;
  source: {
    scope: 'this-device';
    locale: CurrentUser['locale'];
    unitSystem: UnitSystem;
    canonicalUnits: {
      weight: 'kg';
      length: 'cm';
    };
  };
  summary: {
    workouts: number;
    sets: number;
    measurements: number;
    exercises: number;
    pendingRecords: number;
    conflictedRecords: number;
  };
  data: {
    workouts: LocalWorkout[];
    sets: ExportedSet[];
    measurements: ExportedMeasurement[];
    exercises: Exercise[];
  };
};

type LocalDataExportInput = {
  workouts: LocalWorkout[];
  sets: LocalSet[];
  measurements: LocalMeasurement[];
  exercises: Exercise[];
};

type LocalDataExportOptions = {
  exportedAt?: string;
  locale: CurrentUser['locale'];
  unitSystem: UnitSystem;
};

export async function loadLocalDataExport(
  options: LocalDataExportOptions,
): Promise<LocalDataExport> {
  const input = await db.transaction(
    'r',
    [db.workouts, db.sets, db.measurements, db.exercises],
    async () => {
      const [workouts, sets, measurements, exercises] = await Promise.all([
        db.workouts.toArray(),
        db.sets.toArray(),
        db.measurements.toArray(),
        db.exercises.toArray(),
      ]);
      return { workouts, sets, measurements, exercises };
    },
  );

  return buildLocalDataExport(input, options);
}

export function buildLocalDataExport(
  input: LocalDataExportInput,
  { exportedAt = new Date().toISOString(), locale, unitSystem }: LocalDataExportOptions,
): LocalDataExport {
  const workouts = [...input.workouts].sort(compareBy((workout) => workout.startedAt));
  const sets = input.sets
    .filter((set) => !set.deleted)
    .map(({ deleted: _deleted, ...set }) => set)
    .sort(
      compareBy(
        (set) => set.workoutId,
        (set) => set.performedAt,
        (set) => set.position,
      ),
    );
  const measurements = input.measurements
    .filter((measurement) => !measurement.deleted)
    .map(({ deleted: _deleted, ...measurement }) => measurement)
    .sort(compareBy((measurement) => measurement.measuredOn));
  const usedExerciseIds = new Set<string>();
  for (const workout of workouts) {
    for (const item of workout.exercises) usedExerciseIds.add(item.exerciseId);
  }
  for (const set of sets) usedExerciseIds.add(set.exerciseId);
  const exercises = input.exercises
    .filter((exercise) => exercise.scope === 'user' || usedExerciseIds.has(exercise.id))
    .sort(
      compareBy(
        (exercise) => exercise.nameRu,
        (exercise) => exercise.id,
      ),
    );
  const syncStates = [
    ...workouts.map((workout) => workout.syncState),
    ...sets.map((set) => set.syncState),
    ...measurements.map((measurement) => measurement.syncState),
  ];

  return {
    format: localDataExportFormat,
    formatVersion: localDataExportVersion,
    exportedAt,
    source: {
      scope: 'this-device',
      locale,
      unitSystem,
      canonicalUnits: {
        weight: 'kg',
        length: 'cm',
      },
    },
    summary: {
      workouts: workouts.length,
      sets: sets.length,
      measurements: measurements.length,
      exercises: exercises.length,
      pendingRecords: countSyncState(syncStates, 'pending'),
      conflictedRecords: countSyncState(syncStates, 'conflict'),
    },
    data: { workouts, sets, measurements, exercises },
  };
}

export function serializeLocalDataExport(data: LocalDataExport) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function localDataExportFileName(exportedAt: string) {
  const safeTimestamp = exportedAt.replace(/\.\d{3}Z$/, 'Z').replaceAll(':', '-');
  return `mighty-cringe-export-${safeTimestamp}.json`;
}

export type ExportDelivery = 'shared' | 'downloaded' | 'cancelled';

type ExportRuntime = {
  createFile: (contents: string, fileName: string) => File;
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
  download: (file: File, fileName: string) => void;
};

export async function deliverLocalDataExport(
  data: LocalDataExport,
  runtime: ExportRuntime = browserExportRuntime(),
): Promise<ExportDelivery> {
  const fileName = localDataExportFileName(data.exportedAt);
  const file = runtime.createFile(serializeLocalDataExport(data), fileName);
  const shareData: ShareData = {
    files: [file],
    title:
      data.source.locale === 'ru' ? 'MightyCringe — экспорт данных' : 'MightyCringe — data export',
  };

  if (runtime.share && canShareFile(runtime, shareData)) {
    try {
      await runtime.share(shareData);
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }

  runtime.download(file, fileName);
  return 'downloaded';
}

function canShareFile(runtime: ExportRuntime, shareData: ShareData) {
  try {
    return runtime.canShare?.(shareData) ?? false;
  } catch {
    return false;
  }
}

function browserExportRuntime(): ExportRuntime {
  return {
    createFile: (contents, fileName) =>
      new File([contents], fileName, { type: 'application/json;charset=utf-8' }),
    canShare:
      typeof navigator.canShare === 'function' ? navigator.canShare.bind(navigator) : undefined,
    share: typeof navigator.share === 'function' ? navigator.share.bind(navigator) : undefined,
    download: downloadFile,
  };
}

function downloadFile(file: File, fileName: string) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.download = fileName;
  link.href = url;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function countSyncState(states: SyncState[], expected: SyncState) {
  return states.filter((state) => state === expected).length;
}

function compareBy<T>(...selectors: Array<(item: T) => string | number>) {
  return (left: T, right: T) => {
    for (const select of selectors) {
      const leftValue = select(left);
      const rightValue = select(right);
      if (leftValue < rightValue) return -1;
      if (leftValue > rightValue) return 1;
    }
    return 0;
  };
}
