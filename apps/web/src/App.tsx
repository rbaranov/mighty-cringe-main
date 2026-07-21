import { useCallback, useEffect, useMemo, useState } from 'react';

import type { CurrentUser, Exercise, SetInput, WorkoutExercise } from '@mighty-cringe/contracts';
import { useLiveQuery } from 'dexie-react-hooks';

import { SetSheet } from './components/SetSheet';
import type { MeasurementDraft } from './components/BodyMeasurementsSection';
import { ProgressView } from './components/ProgressView';
import {
  activateLocalUser,
  clearLocalUserData,
  db,
  type LocalMeasurement,
  type LocalSet,
  type LocalWorkout,
  type SyncConflict,
} from './lib/db';
import { fallbackCatalog } from './lib/fallbackCatalog';
import { flushOutbox, queueMutation, resolveConflict, syncAll } from './lib/sync';

type View = 'workout' | 'progress' | 'catalog' | 'settings';

const suggestedIds = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006',
];

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous'; googleEnabled: boolean }
  | { status: 'authenticated'; user: CurrentUser };

type ExercisePickerMode = { mode: 'add' } | { mode: 'replace'; itemId: string };

type PendingConfirmation = {
  title: string;
  message: string;
  confirmLabel: string;
  action: () => Promise<void>;
};

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  const loadSession = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/me', { credentials: 'same-origin' });
      if (response.ok) {
        const payload = (await response.json()) as { user: CurrentUser };
        await activateLocalUser(payload.user.id);
        setAuth({ status: 'authenticated', user: payload.user });
        return;
      }

      const configResponse = await fetch('/api/v1/auth/config', { credentials: 'same-origin' });
      const config = configResponse.ok
        ? ((await configResponse.json()) as { googleEnabled: boolean })
        : { googleEnabled: false };
      setAuth({ status: 'anonymous', googleEnabled: config.googleEnabled });
    } catch {
      setAuth({ status: 'anonymous', googleEnabled: false });
    }
  }, []);

  useEffect(() => {
    void loadSession();
    window.addEventListener('mighty-cringe:unauthorized', loadSession);
    return () => window.removeEventListener('mighty-cringe:unauthorized', loadSession);
  }, [loadSession]);

  async function logout() {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' });
    await clearLocalUserData();
    setAuth({ status: 'anonymous', googleEnabled: true });
  }

  if (auth.status === 'loading') return <AuthLoading />;
  if (auth.status === 'anonymous') return <LoginScreen googleEnabled={auth.googleEnabled} />;
  return <AuthenticatedApp onLogout={logout} user={auth.user} />;
}

function AuthenticatedApp({ user, onLogout }: { user: CurrentUser; onLogout: () => void }) {
  const [view, setView] = useState<View>('workout');
  const [sheet, setSheet] = useState<{ exercise: Exercise; set: LocalSet | null } | null>(null);
  const [exercisePicker, setExercisePicker] = useState<ExercisePickerMode | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [inputOpen, setInputOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  const workouts = useLiveQuery(() => db.workouts.orderBy('startedAt').reverse().toArray(), [], []);
  const sets = useLiveQuery(() => db.sets.toArray(), [], []);
  const exercises = useLiveQuery(() => db.exercises.toArray(), [], []);
  const measurements = useLiveQuery(
    () => db.measurements.orderBy('measuredOn').reverse().toArray(),
    [],
    [],
  );
  const outboxCount = useLiveQuery(() => db.outbox.count(), [], 0);
  const conflicts = useLiveQuery(
    () => db.conflicts.orderBy('createdAt').reverse().toArray(),
    [],
    [],
  );

  const activeWorkout = workouts.find((workout) => workout.endedAt === null);
  const suggested = useMemo(
    () =>
      suggestedIds
        .map((id) => exercises.find((exercise) => exercise.id === id))
        .filter(Boolean) as Exercise[],
    [exercises],
  );

  useEffect(() => {
    const populateCatalog = async () => {
      try {
        const response = await fetch('/api/v1/exercises', { credentials: 'same-origin' });
        if (response.status === 401) {
          window.dispatchEvent(new Event('mighty-cringe:unauthorized'));
          return;
        }
        if (!response.ok) throw new Error('Catalog is unavailable');
        const payload = (await response.json()) as { items: Exercise[] };
        await db.exercises.bulkPut(payload.items);
      } catch {
        await db.exercises.bulkPut(fallbackCatalog);
      }
    };
    void populateCatalog();
  }, []);

  useEffect(() => {
    const sync = () => {
      setOnline(navigator.onLine);
      void syncAll();
    };
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    void syncAll();
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  async function startWorkout() {
    const id = crypto.randomUUID();
    const clientMutationId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const workoutExercises = suggested.map((exercise, position) => ({
      id: crypto.randomUUID(),
      exerciseId: exercise.id,
      position,
      supersetGroup: null,
    }));
    await db.workouts.put({
      id,
      startedAt,
      endedAt: null,
      notes: null,
      locale: 'ru',
      exercises: workoutExercises,
      revision: 0,
      updatedAt: startedAt,
      syncState: 'pending',
    });
    await queueMutation({
      type: 'workout.create',
      payload: {
        id,
        clientMutationId,
        startedAt,
        endedAt: null,
        notes: null,
        locale: 'ru',
        exercises: workoutExercises,
      },
    });
    await flushOutbox();
  }

  async function saveSet(input: {
    weightKg: number;
    reps: number;
    rir: number | null;
    comment: string | null;
  }) {
    if (!activeWorkout || !sheet) return;
    if (sheet.set) {
      await db.sets.update(sheet.set.id, { ...input, syncState: 'pending' });
      await queueMutation({
        type: 'set.update',
        payload: {
          clientMutationId: crypto.randomUUID(),
          workoutId: activeWorkout.id,
          setId: sheet.set.id,
          baseRevision: sheet.set.revision,
          changes: input,
        },
      });
      setSheet(null);
      await flushOutbox();
      return;
    }

    const set: SetInput = {
      id: crypto.randomUUID(),
      exerciseId: sheet.exercise.id,
      ...input,
      performedAt: new Date().toISOString(),
      position:
        Math.max(
          -1,
          ...sets
            .filter(
              (item) =>
                item.workoutId === activeWorkout.id &&
                item.exerciseId === sheet.exercise.id &&
                !item.deleted,
            )
            .map((item) => item.position),
        ) + 1,
    };
    const clientMutationId = crypto.randomUUID();
    await db.sets.put({
      ...set,
      workoutId: activeWorkout.id,
      revision: 0,
      updatedAt: set.performedAt,
      syncState: 'pending',
      deleted: false,
    });
    await queueMutation({
      type: 'set.create',
      payload: { clientMutationId, workoutId: activeWorkout.id, set },
    });
    setSheet(null);
    await flushOutbox();
  }

  async function finishWorkout() {
    if (!activeWorkout) return;
    const endedAt = new Date().toISOString();
    await db.workouts.update(activeWorkout.id, { endedAt, syncState: 'pending' });
    await queueMutation({
      type: 'workout.update',
      payload: {
        clientMutationId: crypto.randomUUID(),
        workoutId: activeWorkout.id,
        baseRevision: activeWorkout.revision,
        changes: { endedAt },
      },
    });
    await flushOutbox();
  }

  async function updateWorkoutPlan(nextPlan: WorkoutExercise[]) {
    if (!activeWorkout) return;
    const exercises = normalizePlan(nextPlan);
    await db.workouts.update(activeWorkout.id, { exercises, syncState: 'pending' });
    await queueMutation({
      type: 'workout.update',
      payload: {
        clientMutationId: crypto.randomUUID(),
        workoutId: activeWorkout.id,
        baseRevision: activeWorkout.revision,
        changes: { exercises },
      },
    });
    await flushOutbox();
  }

  async function chooseExercise(exercise: Exercise) {
    if (!activeWorkout || !exercisePicker) return;
    if (exercisePicker.mode === 'add') {
      await updateWorkoutPlan([
        ...activeWorkout.exercises,
        {
          id: crypto.randomUUID(),
          exerciseId: exercise.id,
          position: activeWorkout.exercises.length,
          supersetGroup: null,
        },
      ]);
    } else {
      await updateWorkoutPlan(
        activeWorkout.exercises.map((item) =>
          item.id === exercisePicker.itemId ? { ...item, exerciseId: exercise.id } : item,
        ),
      );
    }
    setExercisePicker(null);
  }

  async function removeExercise(itemId: string) {
    if (!activeWorkout) return;
    const removed = activeWorkout.exercises.find((item) => item.id === itemId);
    let nextPlan = activeWorkout.exercises.filter((item) => item.id !== itemId);
    if (removed?.supersetGroup !== null && removed?.supersetGroup !== undefined) {
      nextPlan = nextPlan.map((item) =>
        item.supersetGroup === removed.supersetGroup ? { ...item, supersetGroup: null } : item,
      );
    }
    await updateWorkoutPlan(nextPlan);
  }

  async function moveExercise(itemId: string, direction: -1 | 1) {
    if (!activeWorkout) return;
    const nextPlan = activeWorkout.exercises
      .map((item) => ({ ...item }))
      .sort((left, right) => left.position - right.position);
    const index = nextPlan.findIndex((item) => item.id === itemId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= nextPlan.length) return;
    const group = nextPlan[index].supersetGroup;
    if (group !== null) {
      for (const item of nextPlan) {
        if (item.supersetGroup === group) item.supersetGroup = null;
      }
    }
    [nextPlan[index], nextPlan[destination]] = [nextPlan[destination], nextPlan[index]];
    await updateWorkoutPlan(nextPlan);
  }

  async function toggleSuperset(itemId: string) {
    if (!activeWorkout) return;
    const nextPlan = activeWorkout.exercises
      .map((item) => ({ ...item }))
      .sort((left, right) => left.position - right.position);
    const index = nextPlan.findIndex((item) => item.id === itemId);
    const current = nextPlan[index];
    const following = nextPlan[index + 1];
    if (!current || !following) return;

    if (current.supersetGroup !== null && current.supersetGroup === following.supersetGroup) {
      const group = current.supersetGroup;
      for (const item of nextPlan) {
        if (item.supersetGroup === group) item.supersetGroup = null;
      }
    } else {
      const detachedGroups = new Set(
        [current.supersetGroup, following.supersetGroup].filter(
          (group): group is number => group !== null,
        ),
      );
      for (const item of nextPlan) {
        if (item.supersetGroup !== null && detachedGroups.has(item.supersetGroup)) {
          item.supersetGroup = null;
        }
      }
      const group = Math.max(0, ...nextPlan.map((item) => item.supersetGroup ?? 0)) + 1;
      current.supersetGroup = group;
      following.supersetGroup = group;
    }
    await updateWorkoutPlan(nextPlan);
  }

  async function deleteSet(set: LocalSet) {
    await db.sets.update(set.id, { deleted: true, syncState: 'pending' });
    await queueMutation({
      type: 'set.delete',
      payload: {
        clientMutationId: crypto.randomUUID(),
        workoutId: set.workoutId,
        setId: set.id,
        baseRevision: set.revision,
      },
    });
    setSheet(null);
    await flushOutbox();
  }

  function requestDeleteSet(set: LocalSet) {
    setConfirmation({
      title: 'Удалить подход?',
      message: `${set.weightKg} кг × ${set.reps}. Подход исчезнет из истории после синхронизации.`,
      confirmLabel: 'Удалить подход',
      action: () => deleteSet(set),
    });
  }

  async function saveMeasurement(draft: MeasurementDraft, existing: LocalMeasurement | null) {
    const updatedAt = new Date().toISOString();
    if (existing) {
      await db.measurements.update(existing.id, {
        ...draft,
        updatedAt,
        syncState: 'pending',
      });
      await queueMutation({
        type: 'measurement.update',
        payload: {
          clientMutationId: crypto.randomUUID(),
          measurementId: existing.id,
          baseRevision: existing.revision,
          changes: draft,
        },
      });
      await flushOutbox();
      return;
    }

    await createLocalMeasurement(draft);
    await flushOutbox();
  }

  async function createLocalMeasurement(draft: MeasurementDraft) {
    const id = crypto.randomUUID();
    const updatedAt = new Date().toISOString();
    await db.measurements.put({
      id,
      ...draft,
      revision: 0,
      updatedAt,
      syncState: 'pending',
      deleted: false,
    });
    await queueMutation({
      type: 'measurement.create',
      payload: {
        id,
        clientMutationId: crypto.randomUUID(),
        ...draft,
      },
    });
  }

  async function importMeasurements(drafts: MeasurementDraft[]) {
    for (const draft of drafts) await createLocalMeasurement(draft);
    await flushOutbox();
  }

  async function deleteMeasurement(measurement: LocalMeasurement) {
    await db.measurements.update(measurement.id, { deleted: true, syncState: 'pending' });
    await queueMutation({
      type: 'measurement.delete',
      payload: {
        clientMutationId: crypto.randomUUID(),
        measurementId: measurement.id,
        baseRevision: measurement.revision,
      },
    });
    await flushOutbox();
  }

  function requestDeleteMeasurement(measurement: LocalMeasurement) {
    setConfirmation({
      title: 'Удалить замер?',
      message: `Запись за ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(new Date(measurement.measuredOn))} исчезнет из истории после синхронизации.`,
      confirmLabel: 'Удалить замер',
      action: () => deleteMeasurement(measurement),
    });
  }

  function requestRemoveExercise(itemId: string, hasLoggedSets: boolean) {
    if (!hasLoggedSets) {
      void removeExercise(itemId);
      return;
    }
    setConfirmation({
      title: 'Убрать упражнение из плана?',
      message: 'Уже записанные подходы сохранятся в тренировке вне текущего плана.',
      confirmLabel: 'Убрать из плана',
      action: () => removeExercise(itemId),
    });
  }

  function confirmPendingAction() {
    const action = confirmation?.action;
    setConfirmation(null);
    if (action) void action();
  }

  async function moveSet(set: LocalSet, direction: -1 | 1) {
    const ordered = sets
      .filter(
        (item) =>
          item.workoutId === set.workoutId && item.exerciseId === set.exerciseId && !item.deleted,
      )
      .sort((left, right) => left.position - right.position);
    const index = ordered.findIndex((item) => item.id === set.id);
    const other = ordered[index + direction];
    if (index < 0 || !other) return;

    const firstPosition = set.position;
    await db.transaction('rw', db.sets, async () => {
      await db.sets.update(set.id, { position: other.position, syncState: 'pending' });
      await db.sets.update(other.id, { position: firstPosition, syncState: 'pending' });
    });
    for (const [item, position] of [
      [set, other.position],
      [other, firstPosition],
    ] as const) {
      await queueMutation({
        type: 'set.update',
        payload: {
          clientMutationId: crypto.randomUUID(),
          workoutId: item.workoutId,
          setId: item.id,
          baseRevision: item.revision,
          changes: { position },
        },
      });
    }
    await flushOutbox();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="brand">Mighty &amp; Cringe</p>
          <p className="subtle">Привет, {firstName(user.displayName)} 👋</p>
        </div>
        <span
          className={
            conflicts.length ? 'sync-state conflict' : online ? 'sync-state online' : 'sync-state'
          }
        >
          {conflicts.length
            ? `Конфликтов: ${conflicts.length}`
            : online
              ? outboxCount
                ? `Синхронизация: ${outboxCount}`
                : 'Синхронизировано'
              : `Офлайн · в очереди ${outboxCount}`}
        </span>
      </header>

      {view === 'workout' && (
        <WorkoutView
          activeWorkout={activeWorkout}
          catalog={exercises}
          exercises={suggested}
          onAddSet={(exercise) => setSheet({ exercise, set: null })}
          onAddExercise={() => setExercisePicker({ mode: 'add' })}
          onDeleteSet={requestDeleteSet}
          onEditSet={(exercise, set) => setSheet({ exercise, set })}
          onFinish={finishWorkout}
          onMoveExercise={moveExercise}
          onMoveSet={moveSet}
          onRemoveExercise={requestRemoveExercise}
          onReplaceExercise={(itemId) => setExercisePicker({ mode: 'replace', itemId })}
          onStart={startWorkout}
          onToggleSuperset={toggleSuperset}
          sets={sets}
          workouts={workouts}
        />
      )}
      {view === 'catalog' && <CatalogView exercises={exercises} />}
      {view === 'progress' && (
        <ProgressView
          exercises={exercises}
          measurements={measurements}
          onDeleteMeasurement={requestDeleteMeasurement}
          onImportMeasurements={importMeasurements}
          onSaveMeasurement={saveMeasurement}
          sets={sets}
          workouts={workouts}
        />
      )}
      {view === 'settings' && (
        <SettingsView conflicts={conflicts} onLogout={onLogout} user={user} />
      )}

      <button className="explain-button" onClick={() => setInputOpen(true)} type="button">
        <span>🎙️✏️</span>
        Пояснить
      </button>
      <nav aria-label="Основная навигация" className="tabs">
        <Tab
          active={view === 'workout'}
          icon="🏋️"
          label="Тренировка"
          onClick={() => setView('workout')}
        />
        <Tab
          active={view === 'progress'}
          icon="📈"
          label="Прогресс"
          onClick={() => setView('progress')}
        />
        <span className="tab-spacer" />
        <Tab
          active={view === 'catalog'}
          icon="📚"
          label="Каталог"
          onClick={() => setView('catalog')}
        />
        <Tab
          active={view === 'settings'}
          icon="⚙️"
          label="Настройки"
          onClick={() => setView('settings')}
        />
      </nav>

      <SetSheet
        exercise={sheet?.exercise ?? null}
        initial={sheet?.set ?? null}
        onClose={() => setSheet(null)}
        onSave={saveSet}
      />
      <ExercisePickerSheet
        catalog={exercises}
        currentPlan={activeWorkout?.exercises ?? []}
        mode={exercisePicker}
        onChoose={chooseExercise}
        onClose={() => setExercisePicker(null)}
      />
      <ConfirmationSheet
        confirmation={confirmation}
        onClose={() => setConfirmation(null)}
        onConfirm={confirmPendingAction}
      />
      {inputOpen && <ExplainSheet onClose={() => setInputOpen(false)} />}
    </main>
  );
}

function AuthLoading() {
  return (
    <main className="auth-shell">
      <p className="brand">Mighty &amp; Cringe</p>
      <div className="auth-card" aria-live="polite">
        <p className="eyebrow">Безопасный вход</p>
        <h1>Проверяем сессию…</h1>
      </div>
    </main>
  );
}

function LoginScreen({ googleEnabled }: { googleEnabled: boolean }) {
  const authError = new URLSearchParams(window.location.search).get('authError');
  return (
    <main className="auth-shell">
      <p className="brand">Mighty &amp; Cringe</p>
      <section className="auth-card">
        <p className="eyebrow">Личный журнал</p>
        <h1>Твои тренировки — только твои</h1>
        <p className="intro">
          Войди через Google. Приложение получит только подтверждённый email, имя и аватар для
          профиля.
        </p>
        {authError && <p className="auth-error">Вход не завершён. Попробуй ещё раз.</p>}
        {googleEnabled ? (
          <a className="button primary action login-button" href="/api/v1/auth/google?returnTo=/">
            Войти через Google
          </a>
        ) : (
          <button className="button primary action" disabled type="button">
            Google OAuth ещё не настроен владельцем
          </button>
        )}
        <p className="privacy-note">
          Сессия хранится в защищённой HttpOnly cookie. Токены Google не сохраняются в браузере.
        </p>
      </section>
    </main>
  );
}

function WorkoutView({
  activeWorkout,
  catalog,
  exercises,
  sets,
  workouts,
  onStart,
  onAddExercise,
  onAddSet,
  onDeleteSet,
  onEditSet,
  onFinish,
  onMoveExercise,
  onMoveSet,
  onRemoveExercise,
  onReplaceExercise,
  onToggleSuperset,
}: {
  activeWorkout: LocalWorkout | undefined;
  catalog: Exercise[];
  exercises: Exercise[];
  sets: LocalSet[];
  workouts: LocalWorkout[];
  onStart: () => void;
  onAddExercise: () => void;
  onAddSet: (exercise: Exercise) => void;
  onDeleteSet: (set: LocalSet) => void;
  onEditSet: (exercise: Exercise, set: LocalSet) => void;
  onFinish: () => void;
  onMoveExercise: (itemId: string, direction: -1 | 1) => void;
  onMoveSet: (set: LocalSet, direction: -1 | 1) => void;
  onRemoveExercise: (itemId: string, hasLoggedSets: boolean) => void;
  onReplaceExercise: (itemId: string) => void;
  onToggleSuperset: (itemId: string) => void;
}) {
  if (!activeWorkout) {
    return (
      <section className="screen">
        <p className="eyebrow">Сегодня</p>
        <h1>Готов к сильному дню?</h1>
        <p className="intro">
          Свободная full-body тренировка. Меняй всё по ходу — приложение подстроится.
        </p>
        <div className="stat-row">
          <Stat
            label="Тренировок"
            value={String(workouts.filter((workout) => workout.endedAt).length)}
          />
          <Stat label="Серия" value="1 день" />
          <Stat label="Режим" value="Full body" />
        </div>
        <button className="button primary action" onClick={onStart} type="button">
          Начать тренировку
        </button>
        <div className="section-head">
          <h2>План на сегодня</h2>
          <span>можно менять</span>
        </div>
        <div className="exercise-list compact">
          {exercises.map((exercise, index) => (
            <div className="exercise-row" key={exercise.id}>
              <span className="order">{index + 1}</span>
              <div>
                <strong>{exercise.nameRu}</strong>
                <small>{muscleLabel(exercise.primaryMuscles[0])}</small>
              </div>
              <Tag tag={exercise.tag} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  const plan = [...activeWorkout.exercises]
    .sort((left, right) => left.position - right.position)
    .flatMap((item) => {
      const exercise = catalog.find((candidate) => candidate.id === item.exerciseId);
      return exercise ? [{ item, exercise }] : [];
    });
  const visibleSets = sets.filter((set) => set.workoutId === activeWorkout.id && !set.deleted);
  const planExerciseIds = new Set(plan.map(({ item }) => item.exerciseId));
  const removedExerciseIds = [...new Set(visibleSets.map((set) => set.exerciseId))].filter(
    (exerciseId) => !planExerciseIds.has(exerciseId),
  );

  return (
    <section className="screen workout-live">
      <div className="section-head live-head">
        <div>
          <p className="eyebrow">Тренировка идёт</p>
          <h1>
            {new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(
              new Date(activeWorkout.startedAt),
            )}
          </h1>
        </div>
        <button className="button ghost small" onClick={onFinish} type="button">
          Завершить
        </button>
      </div>
      <p className="intro">
        План можно менять в любой момент. Удаление упражнения не стирает уже записанные подходы.
      </p>
      <div className="exercise-list">
        {plan.map(({ item, exercise }, index) => {
          const logged = visibleSets
            .filter((set) => set.exerciseId === exercise.id)
            .sort(
              (left, right) =>
                left.position - right.position || left.performedAt.localeCompare(right.performedAt),
            );
          const linkedWithNext =
            item.supersetGroup !== null &&
            item.supersetGroup === plan[index + 1]?.item.supersetGroup;
          return (
            <article
              className={item.supersetGroup === null ? 'exercise-card' : 'exercise-card superset'}
              key={item.id}
            >
              <div className="exercise-card-head">
                <div>
                  <strong>{exercise.nameRu}</strong>
                  <small>{muscleLabel(exercise.primaryMuscles[0])}</small>
                </div>
                <Tag tag={exercise.tag} />
              </div>
              {item.supersetGroup !== null && (
                <span className="superset-label">Суперсет {item.supersetGroup}</span>
              )}
              <div className="plan-controls" aria-label={`План: ${exercise.nameRu}`}>
                <button
                  aria-label="Поднять упражнение"
                  disabled={index === 0}
                  onClick={() => onMoveExercise(item.id, -1)}
                  type="button"
                >
                  ↑
                </button>
                <button
                  aria-label="Опустить упражнение"
                  disabled={index === plan.length - 1}
                  onClick={() => onMoveExercise(item.id, 1)}
                  type="button"
                >
                  ↓
                </button>
                <button onClick={() => onReplaceExercise(item.id)} type="button">
                  Заменить
                </button>
                {index < plan.length - 1 && (
                  <button onClick={() => onToggleSuperset(item.id)} type="button">
                    {linkedWithNext ? 'Разъединить' : 'Суперсет ↓'}
                  </button>
                )}
                <button
                  className="danger-text"
                  onClick={() => onRemoveExercise(item.id, logged.length > 0)}
                  type="button"
                >
                  Убрать
                </button>
              </div>
              {logged.length ? (
                <div className="sets-line set-list">
                  {logged.map((set, setIndex) => (
                    <div className="set-row" key={set.id}>
                      <button
                        className={set.syncState === 'conflict' ? 'set-chip conflict' : 'set-chip'}
                        onClick={() => onEditSet(exercise, set)}
                        type="button"
                      >
                        {setIndex + 1}. {set.weightKg}×{set.reps}
                        {set.rir === null ? '' : ` RIR${set.rir}`}
                        {set.syncState === 'pending' ? ' · ждёт' : ''}
                        {set.syncState === 'conflict' ? ' · конфликт' : ''}
                      </button>
                      <div className="set-controls">
                        <button
                          aria-label="Переместить подход влево"
                          disabled={setIndex === 0}
                          onClick={() => onMoveSet(set, -1)}
                          type="button"
                        >
                          ←
                        </button>
                        <button
                          aria-label="Переместить подход вправо"
                          disabled={setIndex === logged.length - 1}
                          onClick={() => onMoveSet(set, 1)}
                          type="button"
                        >
                          →
                        </button>
                        <button
                          aria-label="Удалить подход"
                          className="danger-text"
                          onClick={() => onDeleteSet(set)}
                          type="button"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="sets-line muted">Ещё нет подходов</p>
              )}
              <button className="add-set" onClick={() => onAddSet(exercise)} type="button">
                ＋ Подход
              </button>
            </article>
          );
        })}
        {!plan.length && (
          <div className="empty-plan">
            <strong>План пока пуст</strong>
            <span>Добавь первое упражнение — подходы сохраняются и офлайн.</span>
          </div>
        )}
        <button className="button ghost full add-exercise" onClick={onAddExercise} type="button">
          ＋ Добавить упражнение
        </button>
        {removedExerciseIds.length > 0 && (
          <div className="removed-sets">
            <p className="eyebrow">Выполнено вне текущего плана</p>
            {removedExerciseIds.map((exerciseId) => {
              const exercise = catalog.find((candidate) => candidate.id === exerciseId);
              const logged = visibleSets
                .filter((set) => set.exerciseId === exerciseId)
                .sort((left, right) => left.position - right.position);
              if (!exercise) return null;
              return (
                <div className="removed-set-summary" key={exerciseId}>
                  <strong>{exercise.nameRu}</strong>
                  {logged.map((set, index) => (
                    <div className="set-row" key={set.id}>
                      <button
                        className="set-chip"
                        onClick={() => onEditSet(exercise, set)}
                        type="button"
                      >
                        {index + 1}. {set.weightKg}×{set.reps}
                      </button>
                      <div className="set-controls">
                        <button
                          aria-label="Переместить подход влево"
                          disabled={index === 0}
                          onClick={() => onMoveSet(set, -1)}
                          type="button"
                        >
                          ←
                        </button>
                        <button
                          aria-label="Переместить подход вправо"
                          disabled={index === logged.length - 1}
                          onClick={() => onMoveSet(set, 1)}
                          type="button"
                        >
                          →
                        </button>
                        <button
                          aria-label="Удалить подход"
                          className="danger-text"
                          onClick={() => onDeleteSet(set)}
                          type="button"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function CatalogView({ exercises }: { exercises: Exercise[] }) {
  return (
    <section className="screen">
      <p className="eyebrow">Общий + личный</p>
      <h1>Каталог упражнений</h1>
      <div className="exercise-list catalog-list">
        {exercises.map((exercise) => (
          <article className="exercise-row catalog" key={exercise.id}>
            <div className="catalog-symbol">
              {exercise.tag === 'mighty' ? '⚡' : exercise.tag === 'cringe' ? '😬' : '•'}
            </div>
            <div>
              <strong>{exercise.nameRu}</strong>
              <small>
                {exercise.nameEn} · {muscleLabel(exercise.primaryMuscles[0])}
              </small>
            </div>
            <Tag tag={exercise.tag} />
          </article>
        ))}
      </div>
    </section>
  );
}

function SettingsView({
  user,
  conflicts,
  onLogout,
}: {
  user: CurrentUser;
  conflicts: SyncConflict[];
  onLogout: () => void;
}) {
  return (
    <section className="screen">
      <p className="eyebrow">Профиль</p>
      <h1>Настройки</h1>
      <div className="profile-card">
        {user.avatarUrl && <img alt="" referrerPolicy="no-referrer" src={user.avatarUrl} />}
        <div>
          <strong>{user.displayName}</strong>
          <small>{user.email}</small>
        </div>
        <span>{user.role === 'admin' ? 'Admin' : 'Athlete'}</span>
      </div>
      {conflicts.length > 0 && (
        <section className="conflict-panel" aria-live="polite">
          <p className="eyebrow">Нужен выбор</p>
          <h2>Изменения с двух устройств</h2>
          <p className="intro">
            Ничего не перезаписано автоматически. Выбери версию для каждой записи.
          </p>
          {conflicts.map((conflict) => (
            <article className="conflict-card" key={conflict.id}>
              <strong>
                {conflict.entityType === 'workout'
                  ? 'Тренировка'
                  : conflict.entityType === 'set'
                    ? 'Подход'
                    : 'Замер тела'}
              </strong>
              <small>{conflict.message}</small>
              <div>
                <button
                  className="button ghost small"
                  onClick={() => void resolveConflict(conflict.id, 'server')}
                  type="button"
                >
                  {conflict.current ? 'Оставить серверную' : 'Удалить локальную'}
                </button>
                <button
                  className="button primary small"
                  disabled={!canKeepMine(conflict)}
                  onClick={() => void resolveConflict(conflict.id, 'mine')}
                  type="button"
                >
                  Сохранить мою
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
      <div className="setting">
        <span>Язык</span>
        <strong>Русский</strong>
      </div>
      <div className="setting">
        <span>Единицы веса</span>
        <strong>кг</strong>
      </div>
      <div className="setting">
        <span>Напоминания</span>
        <strong>В разработке</strong>
      </div>
      <div className="setting">
        <span>Тренер</span>
        <strong>Не подключён</strong>
      </div>
      <p className="privacy-note">
        Перед включением голоса приложение покажет, какие данные будут переданы провайдеру
        распознавания.
      </p>
      <button className="button ghost full" onClick={onLogout} type="button">
        Выйти и удалить локальные данные
      </button>
    </section>
  );
}

function ExercisePickerSheet({
  catalog,
  currentPlan,
  mode,
  onChoose,
  onClose,
}: {
  catalog: Exercise[];
  currentPlan: WorkoutExercise[];
  mode: ExercisePickerMode | null;
  onChoose: (exercise: Exercise) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  useEffect(() => setQuery(''), [mode]);
  if (!mode) return null;

  const replacedItemId = mode.mode === 'replace' ? mode.itemId : null;
  const unavailableIds = new Set(
    currentPlan.filter((item) => item.id !== replacedItemId).map((item) => item.exerciseId),
  );
  const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
  const options = catalog.filter(
    (exercise) =>
      !unavailableIds.has(exercise.id) &&
      (!normalizedQuery ||
        [exercise.nameRu, exercise.nameEn, ...exercise.aliases].some((name) =>
          name.toLocaleLowerCase('ru-RU').includes(normalizedQuery),
        )),
  );

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={mode.mode === 'add' ? 'Добавить упражнение' : 'Заменить упражнение'}
        aria-modal="true"
        className="sheet exercise-picker"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="sheet-handle" />
        <p className="eyebrow">Каталог</p>
        <h2>{mode.mode === 'add' ? 'Добавить упражнение' : 'Чем заменить?'}</h2>
        <input
          autoFocus
          className="exercise-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Название или синоним"
          type="search"
          value={query}
        />
        <div className="picker-list">
          {options.map((exercise) => (
            <button
              className="picker-option"
              key={exercise.id}
              onClick={() => onChoose(exercise)}
              type="button"
            >
              <span>
                <strong>{exercise.nameRu}</strong>
                <small>
                  {exercise.nameEn} · {muscleLabel(exercise.primaryMuscles[0])}
                </small>
              </span>
              <Tag tag={exercise.tag} />
            </button>
          ))}
          {!options.length && <p className="sets-line muted">Ничего не найдено</p>}
        </div>
        <button className="button ghost full" onClick={onClose} type="button">
          Отмена
        </button>
      </section>
    </div>
  );
}

function ConfirmationSheet({
  confirmation,
  onClose,
  onConfirm,
}: {
  confirmation: PendingConfirmation | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!confirmation) return null;

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={confirmation.title}
        aria-modal="true"
        className="sheet confirmation-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="sheet-handle" />
        <p className="eyebrow">Подтверждение</p>
        <h2>{confirmation.title}</h2>
        <p className="confirmation-message">{confirmation.message}</p>
        <button className="button danger full" onClick={onConfirm} type="button">
          {confirmation.confirmLabel}
        </button>
        <button className="button ghost full" onClick={onClose} type="button">
          Отмена
        </button>
      </section>
    </div>
  );
}

function ExplainSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <p className="eyebrow">Пояснить</p>
        <h2>Голос и текст</h2>
        <p className="intro">
          Текстовое и голосовое понимание будет подключено после настройки безопасного AI-ключа.
          Ручной подход уже работает офлайн.
        </p>
        <button className="button primary full" onClick={onClose} type="button">
          Понятно
        </button>
      </section>
    </div>
  );
}

function Tab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`tab ${active ? 'active' : ''}`} onClick={onClick} type="button">
      <span>{icon}</span>
      {label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Tag({ tag }: { tag: Exercise['tag'] }) {
  const labels = { mighty: '⚡ Mighty', normal: '• Normal', cringe: '😬 Cringe' };
  return <span className={`tag ${tag}`}>{labels[tag]}</span>;
}

function muscleLabel(muscle: Exercise['primaryMuscles'][number] | undefined) {
  const labels: Record<string, string> = {
    back: 'Спина',
    middle_delt: 'Средняя дельта',
    chest: 'Грудь',
    biceps: 'Бицепс',
    quadriceps: 'Квадрицепс',
    triceps: 'Трицепс',
    front_delt: 'Передняя дельта',
    rear_delt: 'Задняя дельта',
    hamstrings: 'Бицепс бедра',
    calves: 'Икры',
    core: 'Кор',
  };
  return labels[muscle ?? ''] ?? 'Упражнение';
}

function firstName(displayName: string) {
  return displayName.trim().split(/\s+/)[0] || 'спортсмен';
}

function canKeepMine(conflict: SyncConflict) {
  return (
    conflict.mutation.type === 'workout.update' ||
    conflict.mutation.type === 'set.update' ||
    conflict.mutation.type === 'measurement.update' ||
    (conflict.mutation.type === 'set.delete' && conflict.current !== null) ||
    (conflict.mutation.type === 'measurement.delete' && conflict.current !== null)
  );
}

function normalizePlan(plan: WorkoutExercise[]) {
  const ordered = plan.map((item, position) => ({ ...item, position }));
  const groupPositions = new Map<number, number[]>();
  for (const item of ordered) {
    if (item.supersetGroup === null) continue;
    const positions = groupPositions.get(item.supersetGroup) ?? [];
    positions.push(item.position);
    groupPositions.set(item.supersetGroup, positions);
  }
  const groupNumbers = new Map<number, number>();
  let nextGroup = 1;
  for (const [group, positions] of groupPositions) {
    const consecutive = positions.every(
      (position, index) => index === 0 || position === positions[index - 1] + 1,
    );
    if (positions.length >= 2 && consecutive) groupNumbers.set(group, nextGroup++);
  }
  return ordered.map((item) => ({
    ...item,
    supersetGroup:
      item.supersetGroup === null ? null : (groupNumbers.get(item.supersetGroup) ?? null),
  }));
}
