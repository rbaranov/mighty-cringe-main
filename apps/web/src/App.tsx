import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  exerciseTags,
  muscleGroups,
  workoutPlanSchema,
  type CurrentUser,
  type Exercise,
  type ExercisePreferenceValue,
  type SetEntrySource,
  type SetInput,
  type WorkoutExercise,
} from '@mighty-cringe/contracts';
import { useLiveQuery } from 'dexie-react-hooks';

import { SetSheet } from './components/SetSheet';
import { WorkoutTimingSheet } from './components/WorkoutTimingSheet';
import { WorkoutNotesSheet } from './components/WorkoutNotesSheet';
import { WorkoutFavoriteNameSheet } from './components/WorkoutFavoriteNameSheet';
import { AutoFinishNotice, WorkoutInactivityBanner } from './components/WorkoutLifecycleNotices';
import { ConfirmationSheet } from './components/ConfirmationSheet';
import { ExerciseAddPanel } from './components/ExerciseAddPanel';
import { KeyboardSafeButton } from './components/KeyboardSafeButton';
import { ExerciseDiscoveryPanel } from './components/ExerciseDiscoveryPanel';
import { ExerciseEditorView } from './components/ExerciseEditorView';
import { ExerciseEnrichmentPanel } from './components/ExerciseEnrichmentPanel';
import { FavoriteWorkoutsSection } from './components/FavoriteWorkoutsSection';
import type { MeasurementDraft } from './components/BodyMeasurementsSection';
import { ProgressView } from './components/ProgressView';
import { SettingsView } from './components/SettingsView';
import { TrainerDashboard } from './components/TrainerAccess';
import { VoicePanel } from './components/VoicePanel';
import {
  activateLocalUser,
  cacheCurrentUser,
  clearLocalUserData,
  db,
  disableOfflineSession,
  getCachedCurrentUser,
  type LocalMeasurement,
  type LocalSet,
  type LocalWorkout,
  type SyncConflict,
} from './lib/db';
import {
  advanceConfirmation,
  beginConfirmation,
  conflictNeedsDoubleConfirmation,
  hasLogoutRisks,
  logoutConfirmationSteps,
  missingServerWorkoutDeletionSteps,
  type ConfirmationRequest,
  type LogoutRisks,
  type PendingConfirmation,
  workoutDeletionSteps,
  workoutFavoriteRemovalSteps,
} from './lib/confirmation';
import { fallbackCatalog, retiredGlobalExerciseIds } from './lib/fallbackCatalog';
import {
  catalogDiscoveryQuery,
  collapseExerciseCatalogDuplicates,
  filterExerciseCatalog,
  groupExerciseChoicesByPrimaryMuscle,
  replacementExerciseOptions,
} from './lib/exerciseCatalog';
import { cacheExercise, softDeletePersonalExercise } from './lib/exercises';
import { toggleExercisePreference } from './lib/exercisePreferences';
import { hasPendingRemoteLogout, requestRemoteLogout } from './lib/logout';
import {
  buildNaturalSetExerciseContext,
  parseNaturalSet,
  type NaturalSetDraft,
  type NaturalSetResult,
} from './lib/naturalSet';
import {
  parseNaturalWorkoutCommand,
  type NaturalWorkoutCommand,
  type NaturalWorkoutCommandResult,
  type WorkoutCommandOverrides,
  workoutCommandSummary,
} from './lib/naturalWorkoutCommand';
import {
  exerciseName,
  formatExerciseCount,
  formatWeight,
  PreferencesProvider,
  tr,
  usePreferences,
} from './lib/preferences';
import { setEntrySourceSuffix } from './lib/setEntrySource';
import { nextSetPosition } from './lib/setPosition';
import { resolveSession } from './lib/session';
import { acceptTrainerInviteFromUrl, currentLoginReturnTo } from './lib/trainer';
import {
  flushOutbox,
  getSyncStatus,
  queueMutation,
  resolveConflict,
  subscribeSyncStatus,
  syncAll,
} from './lib/sync';
import {
  applyWorkoutCommandToPlan,
  addExerciseToWorkoutPlan,
  copyWorkoutPlan,
  createWorkoutPlanFromExercises,
  groupWorkoutPlanForDisplay,
  moveWorkoutPlanExercise,
  normalizeWorkoutPlan,
  replaceExerciseInWorkoutPlan,
  toggleWorkoutGroupLink,
} from './lib/workoutPlan';
import { buildSuggestedExercises } from './lib/workoutSuggestions';
import { saveWorkoutFavorite } from './lib/workoutFavorites';
import { saveWorkoutNotes } from './lib/workoutNotes';
import {
  displayedWorkoutDurationSeconds,
  editWorkoutTimingChanges,
  finishWorkoutChanges,
  formatLiveWorkoutDurationSeconds,
  formatWorkoutDurationSeconds,
  resumeWorkoutChanges,
  workoutAutoFinishAfterMs,
  workoutInactivityState,
  workoutWarningAfterMs,
  type WorkoutInactivityState,
} from './lib/workoutLifecycle';

type View = 'workout' | 'progress' | 'catalog' | 'settings' | 'trainer';

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous'; googleEnabled: boolean; serverUnavailable: boolean }
  | { status: 'unavailable' }
  | { status: 'authenticated'; user: CurrentUser; restoredFromCache: boolean };

type ExercisePickerMode =
  | { target: 'current' | 'draft'; mode: 'add' }
  | { target: 'current' | 'draft'; mode: 'replace'; itemId: string };

type NaturalInputResult =
  NaturalSetResult | Exclude<NaturalWorkoutCommandResult, { status: 'not_command' }>;

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  const loadSession = useCallback(async () => {
    try {
      if (hasPendingRemoteLogout()) {
        const logoutCompleted = await requestRemoteLogout();
        if (!logoutCompleted) {
          setAuth({ status: 'anonymous', googleEnabled: false, serverUnavailable: true });
          return;
        }
      }
      const session = await resolveSession({ request: fetch, getCachedUser: getCachedCurrentUser });
      if (session.status === 'authenticated') {
        if (session.source === 'server') {
          await activateLocalUser(session.user.id);
          await cacheCurrentUser(session.user);
        }
        setAuth({
          status: 'authenticated',
          user: session.user,
          restoredFromCache: session.source === 'cache',
        });
        return;
      }
      if (session.serverRejected) await disableOfflineSession();
      setAuth({
        status: 'anonymous',
        googleEnabled: session.googleEnabled,
        serverUnavailable: session.serverUnavailable,
      });
    } catch (error) {
      console.error('MightyCringe could not initialize the local session', error);
      setAuth({ status: 'unavailable' });
    }
  }, []);

  useEffect(() => {
    void loadSession();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadSession();
    };
    window.addEventListener('mighty-cringe:unauthorized', loadSession);
    window.addEventListener('online', loadSession);
    window.addEventListener('pageshow', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('mighty-cringe:unauthorized', loadSession);
      window.removeEventListener('online', loadSession);
      window.removeEventListener('pageshow', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadSession]);

  async function logout() {
    await requestRemoteLogout();
    await clearLocalUserData();
    setAuth({ status: 'anonymous', googleEnabled: true, serverUnavailable: false });
  }

  async function updateUser(user: CurrentUser) {
    await cacheCurrentUser(user);
    setAuth({ status: 'authenticated', user, restoredFromCache: false });
  }

  if (auth.status === 'loading') return <AuthLoading />;
  if (auth.status === 'unavailable') {
    return (
      <SessionUnavailable
        onRetry={() => {
          setAuth({ status: 'loading' });
          void loadSession();
        }}
      />
    );
  }
  if (auth.status === 'anonymous') {
    return (
      <LoginScreen
        googleEnabled={auth.googleEnabled}
        onRetry={() => {
          setAuth({ status: 'loading' });
          void loadSession();
        }}
        serverUnavailable={auth.serverUnavailable}
      />
    );
  }
  return (
    <AuthenticatedApp
      onLogout={logout}
      onUserUpdated={updateUser}
      restoredFromCache={auth.restoredFromCache}
      user={auth.user}
    />
  );
}

type AuthenticatedAppProps = {
  user: CurrentUser;
  restoredFromCache: boolean;
  onLogout: () => void;
  onUserUpdated: (user: CurrentUser) => Promise<void>;
};

function AuthenticatedApp(props: AuthenticatedAppProps) {
  useEffect(() => {
    document.documentElement.lang = props.user.locale;
  }, [props.user.locale]);
  return (
    <PreferencesProvider locale={props.user.locale} unitSystem={props.user.unitSystem}>
      <AuthenticatedAppContent {...props} />
    </PreferencesProvider>
  );
}

function AuthenticatedAppContent({
  user,
  restoredFromCache,
  onLogout,
  onUserUpdated,
}: AuthenticatedAppProps) {
  const { locale, unitSystem } = usePreferences();
  const [view, setView] = useState<View>('workout');
  const [sheet, setSheet] = useState<{ exercise: Exercise; set: LocalSet | null } | null>(null);
  const [exercisePicker, setExercisePicker] = useState<ExercisePickerMode | null>(null);
  const [draftPlan, setDraftPlan] = useState<WorkoutExercise[] | null>(null);
  const [exerciseDetailId, setExerciseDetailId] = useState<string | null>(null);
  const [exerciseEditor, setExerciseEditor] = useState<Exercise | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [explainContext, setExplainContext] = useState<{ exercise: Exercise | null } | null>(null);
  const [editingWorkoutId, setEditingWorkoutId] = useState<string | null>(null);
  const [timingWorkoutId, setTimingWorkoutId] = useState<string | null>(null);
  const [favoriteNameWorkoutId, setFavoriteNameWorkoutId] = useState<string | null>(null);
  const [lifecycleNow, setLifecycleNow] = useState(() => Date.now());
  const finishingWorkoutId = useRef<string | null>(null);
  const resumingWorkoutId = useRef<string | null>(null);
  const initialSyncPromise = useRef<ReturnType<typeof syncAll> | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [relationshipRefreshKey, setRelationshipRefreshKey] = useState(0);
  const [initialSyncCompleted, setInitialSyncCompleted] = useState(false);
  const inviteHandled = useRef(false);
  const syncStatusRef = useRef<HTMLDetailsElement>(null);
  const syncStatus = useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);

  const storedWorkouts = useLiveQuery(
    () => db.workouts.orderBy('startedAt').reverse().toArray(),
    [],
  );
  const workouts = storedWorkouts ?? [];
  const sets = useLiveQuery(() => db.sets.toArray(), [], []);
  const exercises = useLiveQuery(() => db.exercises.toArray(), [], []);
  const exercisePreferences = useLiveQuery(() => db.exercisePreferences.toArray(), []);
  const preferenceByExerciseId = useMemo(
    () =>
      new Map(
        (exercisePreferences ?? []).map(
          (preference) => [preference.exerciseId, preference.value] as const,
        ),
      ),
    [exercisePreferences],
  );
  const availableExercises = useMemo(
    () =>
      exercises.filter(
        (exercise) => !exercise.deletedAt && !retiredGlobalExerciseIds.has(exercise.id),
      ),
    [exercises],
  );
  const catalogChoices = useMemo(
    () => collapseExerciseCatalogDuplicates(availableExercises),
    [availableExercises],
  );
  const measurements = useLiveQuery(
    () => db.measurements.orderBy('measuredOn').reverse().toArray(),
    [],
    [],
  );
  const outboxCount = useLiveQuery(() => db.outbox.count(), [], 0);
  const lastSuccessfulSyncAt = useLiveQuery(
    async () => (await db.meta.get('lastSuccessfulSyncAt'))?.value ?? null,
    [],
    null,
  );
  const autoFinishNoticeWorkoutId = useLiveQuery(
    async () => (await db.meta.get('autoFinishNoticeWorkoutId'))?.value ?? null,
    [],
    null,
  );
  const storedDraftPlan = useLiveQuery(
    async () => ({ value: (await db.meta.get('draftWorkoutPlan'))?.value ?? null }),
    [],
  );
  const conflicts = useLiveQuery(
    () => db.conflicts.orderBy('createdAt').reverse().toArray(),
    [],
    [],
  );
  const hydrationChecked = useRef(false);
  const [recoveredWorkoutId, setRecoveredWorkoutId] = useState<string | null>(null);

  useEffect(() => {
    if (inviteHandled.current || restoredFromCache || !navigator.onLine) return;
    if (!new URLSearchParams(window.location.search).has('trainerInvite')) return;
    inviteHandled.current = true;
    void acceptTrainerInviteFromUrl(window.location.href)
      .then((result) => {
        if (!result) return;
        window.history.replaceState({}, '', result.cleanUrl);
        setInviteNotice(
          tr(
            locale,
            `Тренер ${result.trainer.displayName} подключён. Доступ можно отозвать здесь.`,
            `Coach ${result.trainer.displayName} is connected. You can revoke access here.`,
          ),
        );
        setRelationshipRefreshKey((value) => value + 1);
        setView('settings');
      })
      .catch((error) => {
        inviteHandled.current = false;
        setInviteNotice(
          error instanceof Error
            ? error.message
            : tr(
                locale,
                'Не удалось принять приглашение тренера.',
                'Could not accept the coach invitation.',
              ),
        );
      });
  }, [restoredFromCache]);

  useEffect(() => {
    if (hydrationChecked.current || storedWorkouts === undefined) return;
    hydrationChecked.current = true;
    setRecoveredWorkoutId(storedWorkouts.find((workout) => workout.endedAt === null)?.id ?? null);
  }, [storedWorkouts]);

  const activeWorkout = workouts.find((workout) => workout.endedAt === null);
  const autoFinishedWorkout = autoFinishNoticeWorkoutId
    ? workouts.find(
        (workout) =>
          workout.id === autoFinishNoticeWorkoutId &&
          workout.endedAt !== null &&
          workout.completionReason === 'automatic',
      )
    : undefined;
  const timingWorkout = timingWorkoutId
    ? workouts.find((workout) => workout.id === timingWorkoutId && workout.endedAt !== null)
    : undefined;
  const favoriteNameWorkout = favoriteNameWorkoutId
    ? workouts.find((workout) => workout.id === favoriteNameWorkoutId && workout.endedAt !== null)
    : undefined;
  const editingWorkout = editingWorkoutId
    ? workouts.find((workout) => workout.id === editingWorkoutId && workout.endedAt !== null)
    : undefined;
  const workoutContext = editingWorkout ?? activeWorkout;
  const favoriteWorkouts = useMemo(
    () => workouts.filter((workout) => workout.endedAt !== null && workout.isFavorite),
    [workouts],
  );

  useEffect(() => {
    if (
      activeWorkout ||
      draftPlan !== null ||
      storedDraftPlan === undefined ||
      exercisePreferences === undefined ||
      !initialSyncCompleted
    )
      return;
    const saved = parseDraftWorkoutPlan(storedDraftPlan.value);
    if (saved) {
      setDraftPlan(saved);
      return;
    }
    if (!catalogChoices.length) return;
    if (storedDraftPlan.value !== null) void db.meta.delete('draftWorkoutPlan');
    let disposed = false;
    void Promise.all([db.exercisePreferences.toArray(), db.workouts.toArray()]).then(
      ([latestPreferences, latestWorkouts]) => {
        if (disposed || latestWorkouts.some((workout) => workout.endedAt === null)) return;
        const latestPreferenceLookup = new Map(
          latestPreferences.map((preference) => [preference.exerciseId, preference.value] as const),
        );
        const latestSuggestions = buildSuggestedExercises({
          catalog: catalogChoices,
          workouts: latestWorkouts,
          preferences: latestPreferenceLookup,
        });
        setDraftPlan((current) => current ?? createWorkoutPlanFromExercises(latestSuggestions));
      },
    );
    return () => {
      disposed = true;
    };
  }, [
    activeWorkout?.id,
    catalogChoices,
    draftPlan,
    exercisePreferences,
    initialSyncCompleted,
    storedDraftPlan,
  ]);
  const setDefaults = useMemo(() => {
    if (!sheet || sheet.set) return null;
    const candidates = sets.filter((set) => set.exerciseId === sheet.exercise.id && !set.deleted);
    const currentWorkoutSet = workoutContext
      ? candidates
          .filter((set) => set.workoutId === workoutContext.id)
          .sort(
            (left, right) =>
              right.position - left.position || right.performedAt.localeCompare(left.performedAt),
          )[0]
      : null;
    return (
      currentWorkoutSet ??
      candidates.sort((left, right) => right.performedAt.localeCompare(left.performedAt))[0] ??
      null
    );
  }, [sets, sheet, workoutContext]);
  const exerciseDetail = exerciseDetailId
    ? (exercises.find((exercise) => exercise.id === exerciseDetailId) ?? null)
    : null;
  const inactivityState = activeWorkout
    ? workoutInactivityState(activeWorkout, lifecycleNow)
    : ({ phase: 'active', remainingSeconds: null } satisfies WorkoutInactivityState);

  useEffect(() => {
    if (!activeWorkout) return;

    const refreshLifecycleClock = () => setLifecycleNow(Date.now());
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshLifecycleClock();
    };
    const interval = window.setInterval(
      refreshLifecycleClock,
      inactivityState.phase === 'warning' ? 1_000 : 60_000,
    );
    const inactivityMs = Math.max(0, Date.now() - new Date(activeWorkout.lastActivityAt).getTime());
    const nextBoundaryMs =
      inactivityMs < workoutWarningAfterMs
        ? workoutWarningAfterMs - inactivityMs
        : workoutAutoFinishAfterMs - inactivityMs;
    const boundaryTimeout = window.setTimeout(
      refreshLifecycleClock,
      Math.max(0, nextBoundaryMs) + 25,
    );
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshLifecycleClock);
    window.addEventListener('pageshow', refreshLifecycleClock);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(boundaryTimeout);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshLifecycleClock);
      window.removeEventListener('pageshow', refreshLifecycleClock);
    };
  }, [activeWorkout?.id, activeWorkout?.lastActivityAt, inactivityState.phase]);

  useEffect(() => {
    if (!activeWorkout || inactivityState.phase !== 'expired') return;
    void finishWorkout('automatic', new Date(lifecycleNow).toISOString());
  }, [activeWorkout?.id, inactivityState.phase, lifecycleNow]);

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
        await db.transaction('rw', db.exercises, db.outbox, async () => {
          const pendingExerciseIds = new Set(
            (await db.outbox.toArray()).flatMap((item) =>
              item.mutation.type === 'exercise.create' ? [item.mutation.payload.id] : [],
            ),
          );
          const pendingExercises = (await db.exercises.toArray()).filter((exercise) =>
            pendingExerciseIds.has(exercise.id),
          );
          await db.exercises.clear();
          await db.exercises.bulkPut(payload.items);
          await db.exercises.bulkPut(pendingExercises);
        });
      } catch {
        await db.exercises.bulkPut(fallbackCatalog);
      }
    };
    void populateCatalog();
  }, []);

  useEffect(() => {
    let disposed = false;
    const sync = () => {
      void syncAll();
    };
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    const firstSync = syncAll();
    initialSyncPromise.current = firstSync;
    void firstSync.finally(() => {
      if (!disposed) setInitialSyncCompleted(true);
    });
    return () => {
      disposed = true;
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  useEffect(() => {
    function closeSyncStatus(event: PointerEvent) {
      const details = syncStatusRef.current;
      if (!details?.open || !(event.target instanceof Node) || details.contains(event.target))
        return;
      details.open = false;
    }

    function closeSyncStatusOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !syncStatusRef.current?.open) return;
      syncStatusRef.current.open = false;
      syncStatusRef.current.querySelector('summary')?.focus();
    }

    document.addEventListener('pointerdown', closeSyncStatus);
    document.addEventListener('keydown', closeSyncStatusOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeSyncStatus);
      document.removeEventListener('keydown', closeSyncStatusOnEscape);
    };
  }, []);

  async function createWorkoutWithPlan(workoutExercises: WorkoutExercise[]) {
    setEditingWorkoutId(null);
    const id = crypto.randomUUID();
    const clientMutationId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    await db.workouts.put({
      id,
      startedAt,
      endedAt: null,
      durationSeconds: 0,
      activeSegmentStartedAt: startedAt,
      lastActivityAt: startedAt,
      completionReason: null,
      isFavorite: false,
      favoriteName: null,
      notes: null,
      locale,
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
        durationSeconds: 0,
        activeSegmentStartedAt: startedAt,
        lastActivityAt: startedAt,
        completionReason: null,
        isFavorite: false,
        favoriteName: null,
        notes: null,
        locale,
        exercises: workoutExercises,
        activityAt: startedAt,
      },
    });
    await flushOutbox();
  }

  async function updateDraftPlan(nextPlan: WorkoutExercise[]) {
    const normalized = normalizeWorkoutPlan(nextPlan);
    setDraftPlan(normalized);
    await db.meta.put({ key: 'draftWorkoutPlan', value: JSON.stringify(normalized) });
  }

  async function clearDraftPlan() {
    setDraftPlan([]);
    await db.meta.delete('draftWorkoutPlan');
  }

  async function startWorkout() {
    if (draftPlan !== null) {
      await createWorkoutWithPlan(draftPlan);
      await clearDraftPlan();
      return;
    }
    await (initialSyncPromise.current ?? syncAll());
    const [latestPreferences, latestWorkouts] = await Promise.all([
      db.exercisePreferences.toArray(),
      db.workouts.toArray(),
    ]);
    if (latestWorkouts.some((workout) => workout.endedAt === null)) return;
    const latestPreferenceLookup = new Map(
      latestPreferences.map((preference) => [preference.exerciseId, preference.value] as const),
    );
    const latestSuggestions = buildSuggestedExercises({
      catalog: catalogChoices,
      workouts: latestWorkouts,
      preferences: latestPreferenceLookup,
    });
    await createWorkoutWithPlan(createWorkoutPlanFromExercises(latestSuggestions));
    await clearDraftPlan();
  }

  async function repeatWorkout(workout: LocalWorkout) {
    if (activeWorkout || workout.endedAt === null) return;
    await createWorkoutWithPlan(copyWorkoutPlan(workout.exercises));
    await clearDraftPlan();
    setExerciseDetailId(null);
    setView('workout');
  }

  async function updateWorkoutFavorite(
    workout: LocalWorkout,
    isFavorite: boolean,
    favoriteName: string | null = workout.favoriteName,
  ) {
    await saveWorkoutFavorite(workout, isFavorite, favoriteName);
  }

  async function updateWorkoutNotes(workout: LocalWorkout, notes: string) {
    await saveWorkoutNotes(workout, notes);
    if (workout.endedAt === null) setLifecycleNow(Date.now());
  }

  function requestToggleWorkoutFavorite(workout: LocalWorkout) {
    if (!workout.isFavorite) {
      setFavoriteNameWorkoutId(workout.id);
      return;
    }
    openConfirmation({
      steps: workoutFavoriteRemovalSteps(locale),
      action: () => updateWorkoutFavorite(workout, false),
    });
  }

  function requestEditWorkoutFavoriteName(workout: LocalWorkout) {
    if (workout.endedAt === null || !workout.isFavorite) return;
    setFavoriteNameWorkoutId(workout.id);
  }

  function openConfirmation(request: ConfirmationRequest) {
    setConfirmation(beginConfirmation(request));
  }

  function requestRepeatWorkout(workout: LocalWorkout) {
    if (!activeWorkout) {
      void repeatWorkout(workout);
      return;
    }
    openConfirmation({
      steps: [
        {
          title: tr(locale, 'Уже идёт тренировка', 'A workout is already active'),
          message: tr(
            locale,
            'Повтор не запущен: текущая тренировка и её план сохранены без изменений. Сначала заверши её.',
            'The repeat was not started: your current workout and its plan remain unchanged. Finish it first.',
          ),
          confirmLabel: tr(locale, 'К текущей тренировке', 'Open current workout'),
        },
      ],
      action: async () => {
        setEditingWorkoutId(null);
        setView('workout');
      },
    });
  }

  async function saveSet(input: {
    weightKg: number;
    reps: number;
    rir: number | null;
    comment: string | null;
  }) {
    if (!workoutContext || !sheet) return;
    const activeSheet = sheet;
    const activeWorkout = workoutContext;
    const activityAt = new Date().toISOString();
    setSheet(null);
    try {
      if (activeSheet.set) {
        await db.sets.update(activeSheet.set.id, { ...input, syncState: 'pending' });
        await recordLocalWorkoutActivity(activeWorkout.id, activityAt);
        await queueMutation({
          type: 'set.update',
          payload: {
            clientMutationId: crypto.randomUUID(),
            workoutId: activeWorkout.id,
            setId: activeSheet.set.id,
            baseRevision: activeSheet.set.revision,
            changes: input,
            activityAt,
          },
        });
        return;
      }

      await createSet(activeSheet.exercise, input);
    } catch (error) {
      setSheet(activeSheet);
      throw error;
    }
  }

  async function createSet(
    exercise: Exercise,
    input: NaturalSetDraft,
    entrySource: SetEntrySource = 'manual',
  ) {
    if (!workoutContext) return;
    const activityAt = new Date().toISOString();
    const performedAt = editingWorkout?.endedAt ?? activityAt;
    const set = await db.transaction('rw', db.sets, async () => {
      const existingSets = await db.sets.where('workoutId').equals(workoutContext.id).toArray();
      const nextSet: SetInput = {
        id: crypto.randomUUID(),
        exerciseId: exercise.id,
        ...input,
        entrySource,
        performedAt,
        position: nextSetPosition(existingSets, exercise.id),
      };
      await db.sets.put({
        ...nextSet,
        workoutId: workoutContext.id,
        revision: 0,
        updatedAt: nextSet.performedAt,
        syncState: 'pending',
        deleted: false,
      });
      return nextSet;
    });
    const clientMutationId = crypto.randomUUID();
    await recordLocalWorkoutActivity(workoutContext.id, activityAt);
    await queueMutation({
      type: 'set.create',
      payload: { clientMutationId, workoutId: workoutContext.id, set, activityAt },
    });
  }

  async function saveNaturalSet(
    exercise: Exercise,
    input: NaturalSetDraft,
    entrySource: Extract<SetEntrySource, 'natural_text' | 'voice_ai'>,
  ) {
    await createSet(exercise, input, entrySource);
    setExplainContext(null);
  }

  async function finishWorkout(
    reason: 'manual' | 'automatic' = 'manual',
    processedAt = new Date().toISOString(),
  ) {
    const workoutId = activeWorkout?.id;
    if (!workoutId || finishingWorkoutId.current === workoutId) return;
    finishingWorkoutId.current = workoutId;
    try {
      const workout = await db.workouts.get(workoutId);
      if (!workout || workout.endedAt !== null) return;
      if (
        reason === 'automatic' &&
        workoutInactivityState(workout, new Date(processedAt).getTime()).phase !== 'expired'
      ) {
        return;
      }
      const changes = finishWorkoutChanges(workout, processedAt, reason);
      const activityAt = reason === 'automatic' ? workout.lastActivityAt : processedAt;
      const mutation = {
        type: 'workout.update',
        payload: {
          clientMutationId: crypto.randomUUID(),
          workoutId: workout.id,
          baseRevision: workout.revision,
          changes,
          activityAt,
        },
      } as const;
      await db.transaction('rw', db.workouts, db.meta, db.outbox, async () => {
        await db.workouts.update(workout.id, { ...changes, syncState: 'pending' });
        if (reason === 'automatic') {
          await db.meta.put({ key: 'autoFinishNoticeWorkoutId', value: workout.id });
        }
        await queueMutation(mutation);
      });
      setDraftPlan(null);
      await flushOutbox();
    } finally {
      finishingWorkoutId.current = null;
    }
  }

  async function updateWorkoutLifecycle(
    workout: LocalWorkout,
    changes: ReturnType<typeof resumeWorkoutChanges>,
    activityAt: string,
  ) {
    await db.workouts.update(workout.id, { ...changes, syncState: 'pending' });
    await queueMutation({
      type: 'workout.update',
      payload: {
        clientMutationId: crypto.randomUUID(),
        workoutId: workout.id,
        baseRevision: workout.revision,
        changes,
        activityAt,
      },
    });
  }

  async function recordLocalWorkoutActivity(workoutId: string, activityAt: string) {
    const workout = await db.workouts.get(workoutId);
    if (
      !workout ||
      workout.endedAt !== null ||
      new Date(activityAt).getTime() <= new Date(workout.lastActivityAt).getTime()
    ) {
      return;
    }
    await db.workouts.update(workoutId, { lastActivityAt: activityAt });
    setLifecycleNow(new Date(activityAt).getTime());
  }

  async function touchActiveWorkout() {
    if (!activeWorkout) return;
    const activityAt = new Date().toISOString();
    await recordLocalWorkoutActivity(activeWorkout.id, activityAt);
    await queueMutation({
      type: 'workout.touch',
      payload: {
        clientMutationId: crypto.randomUUID(),
        workoutId: activeWorkout.id,
        activityAt,
      },
    });
    await flushOutbox();
  }

  async function dismissAutoFinishNotice() {
    await db.meta.delete('autoFinishNoticeWorkoutId');
  }

  async function saveWorkoutTiming(
    workout: LocalWorkout,
    startedAt: string,
    durationSeconds: number,
  ) {
    const activityAt = new Date().toISOString();
    const changes = editWorkoutTimingChanges(startedAt, durationSeconds);
    await db.workouts.update(workout.id, { ...changes, syncState: 'pending' });
    await queueMutation({
      type: 'workout.update',
      payload: {
        clientMutationId: crypto.randomUUID(),
        workoutId: workout.id,
        baseRevision: workout.revision,
        changes,
        activityAt,
      },
    });
    setTimingWorkoutId(null);
    await dismissAutoFinishNotice();
    await flushOutbox();
  }

  function requestFinishWorkout() {
    if (!activeWorkout) return;
    openConfirmation({
      steps: [
        {
          title: tr(locale, 'Завершить тренировку?', 'Finish this workout?'),
          message: tr(
            locale,
            'Тренировка перестанет быть активной и появится в истории прогресса.',
            'The workout will stop being active and appear in your progress history.',
          ),
          confirmLabel: tr(locale, 'Да, завершить', 'Yes, finish'),
        },
      ],
      action: () => finishWorkout('manual'),
    });
  }

  async function resumeWorkout(workout: LocalWorkout) {
    if (workout.endedAt === null || resumingWorkoutId.current === workout.id) return;
    resumingWorkoutId.current = workout.id;
    try {
      const selected = await db.workouts.get(workout.id);
      if (!selected || selected.endedAt === null) return;
      const activityAt = new Date().toISOString();
      if (activeWorkout && activeWorkout.id !== selected.id) {
        const current = await db.workouts.get(activeWorkout.id);
        if (current?.endedAt === null) {
          const finishChanges = finishWorkoutChanges(current, activityAt, 'manual');
          await db.workouts.update(current.id, { ...finishChanges, syncState: 'pending' });
          await queueMutation({
            type: 'workout.update',
            payload: {
              clientMutationId: crypto.randomUUID(),
              workoutId: current.id,
              baseRevision: current.revision,
              changes: finishChanges,
              activityAt,
            },
          });
        }
      }
      await updateWorkoutLifecycle(selected, resumeWorkoutChanges(activityAt), activityAt);
      await dismissAutoFinishNotice();
      setEditingWorkoutId(null);
      setView('workout');
      await flushOutbox();
    } finally {
      resumingWorkoutId.current = null;
    }
  }

  function requestResumeWorkout(workout: LocalWorkout) {
    if (!activeWorkout || activeWorkout.id === workout.id) {
      void resumeWorkout(workout);
      return;
    }
    openConfirmation({
      steps: [
        {
          title: tr(locale, 'Продолжить прошлую тренировку?', 'Continue the past workout?'),
          message: tr(
            locale,
            'Текущая активная тренировка будет завершена сейчас, а выбранная снова станет активной.',
            'The current active workout will finish now, and the selected workout will become active again.',
          ),
          confirmLabel: tr(locale, 'Завершить текущую и продолжить', 'Finish current and continue'),
        },
      ],
      action: () => resumeWorkout(workout),
    });
  }

  function editCompletedWorkout(workout: LocalWorkout) {
    if (workout.endedAt === null) return;
    setEditingWorkoutId(workout.id);
    setView('workout');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  async function updateWorkoutPlan(nextPlan: WorkoutExercise[]) {
    if (!workoutContext) return;
    const activityAt = new Date().toISOString();
    const exercises = normalizeWorkoutPlan(nextPlan);
    const changes = {
      exercises,
      ...(workoutContext.endedAt === null ? { lastActivityAt: activityAt } : {}),
    };
    await db.workouts.update(workoutContext.id, { ...changes, syncState: 'pending' });
    if (workoutContext.endedAt === null) setLifecycleNow(new Date(activityAt).getTime());
    await queueMutation({
      type: 'workout.update',
      payload: {
        clientMutationId: crypto.randomUUID(),
        workoutId: workoutContext.id,
        baseRevision: workoutContext.revision,
        changes,
        activityAt,
      },
    });
    await flushOutbox();
  }

  async function executeWorkoutCommand(command: NaturalWorkoutCommand) {
    if (!workoutContext) return;
    await updateWorkoutPlan(applyWorkoutCommandToPlan(workoutContext.exercises, command));
    setExplainContext(null);
  }

  async function chooseExercise(exercise: Exercise) {
    if (!exercisePicker) return;
    const picker = exercisePicker;
    setExercisePicker(null);
    try {
      if (picker.target === 'draft') {
        const current = draftPlan ?? [];
        await updateDraftPlan(
          picker.mode === 'add'
            ? addExerciseToWorkoutPlan(current, exercise.id)
            : replaceExerciseInWorkoutPlan(current, picker.itemId, exercise.id),
        );
        return;
      }
      if (!workoutContext) return;
      if (picker.mode === 'add') {
        await updateWorkoutPlan([
          ...workoutContext.exercises,
          {
            id: crypto.randomUUID(),
            exerciseId: exercise.id,
            position: workoutContext.exercises.length,
            supersetGroup: null,
          },
        ]);
      } else {
        await updateWorkoutPlan(
          workoutContext.exercises.map((item) =>
            item.id === picker.itemId ? { ...item, exerciseId: exercise.id } : item,
          ),
        );
      }
    } catch (error) {
      setExercisePicker(picker);
      throw error;
    }
  }

  async function removeDraftExercise(itemId: string) {
    if (!draftPlan) return;
    await updateDraftPlan(draftPlan.filter((item) => item.id !== itemId));
  }

  async function moveDraftExercise(itemId: string, direction: -1 | 1) {
    if (!draftPlan) return;
    await updateDraftPlan(moveWorkoutPlanExercise(draftPlan, itemId, direction));
  }

  async function toggleDraftSuperset(itemId: string) {
    if (!draftPlan) return;
    await updateDraftPlan(toggleWorkoutGroupLink(draftPlan, itemId));
  }

  async function removeExercise(itemId: string) {
    if (!workoutContext) return;
    await updateWorkoutPlan(workoutContext.exercises.filter((item) => item.id !== itemId));
  }

  async function moveExercise(itemId: string, direction: -1 | 1) {
    if (!workoutContext) return;
    const nextPlan = workoutContext.exercises
      .map((item) => ({ ...item }))
      .sort((left, right) => left.position - right.position);
    const index = nextPlan.findIndex((item) => item.id === itemId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= nextPlan.length) return;
    if (nextPlan[index].supersetGroup !== nextPlan[destination].supersetGroup) {
      nextPlan[index].supersetGroup = null;
    }
    [nextPlan[index], nextPlan[destination]] = [nextPlan[destination], nextPlan[index]];
    await updateWorkoutPlan(nextPlan);
  }

  async function toggleSuperset(itemId: string) {
    if (!workoutContext) return;
    await updateWorkoutPlan(toggleWorkoutGroupLink(workoutContext.exercises, itemId));
  }

  async function deleteSet(set: LocalSet) {
    const activityAt = new Date().toISOString();
    await db.sets.update(set.id, { deleted: true, syncState: 'pending' });
    await recordLocalWorkoutActivity(set.workoutId, activityAt);
    await queueMutation({
      type: 'set.delete',
      payload: {
        clientMutationId: crypto.randomUUID(),
        workoutId: set.workoutId,
        setId: set.id,
        baseRevision: set.revision,
        activityAt,
      },
    });
    setSheet(null);
    await flushOutbox();
  }

  function requestDeleteSet(set: LocalSet) {
    openConfirmation({
      steps: [
        {
          title: tr(locale, 'Удалить подход?', 'Delete set?'),
          message: tr(
            locale,
            `${formatWeight(set.weightKg, locale, unitSystem)} × ${set.reps}. Подход исчезнет из истории после синхронизации.`,
            `${formatWeight(set.weightKg, locale, unitSystem)} × ${set.reps}. The set will disappear from history after syncing.`,
          ),
          confirmLabel: tr(locale, 'Удалить подход', 'Delete set'),
        },
      ],
      action: () => deleteSet(set),
    });
  }

  async function deleteWorkout(workout: LocalWorkout) {
    const queued = await db.outbox.toArray();
    const supersededMutationIds = queued
      .filter((item) => mutationWorkoutId(item.mutation) === workout.id)
      .map((item) => item.id);
    if (workout.revision > 0) {
      await queueMutation({
        type: 'workout.delete',
        payload: {
          clientMutationId: crypto.randomUUID(),
          workoutId: workout.id,
          baseRevision: workout.revision,
          activityAt: new Date().toISOString(),
        },
      });
    }
    await db.transaction('rw', db.workouts, db.sets, db.outbox, async () => {
      await db.sets.where('workoutId').equals(workout.id).delete();
      await db.workouts.delete(workout.id);
      await db.outbox.bulkDelete(supersededMutationIds);
    });
    if (autoFinishNoticeWorkoutId === workout.id) await dismissAutoFinishNotice();
    setEditingWorkoutId(null);
    setExerciseDetailId(null);
    setView('progress');
    await flushOutbox();
  }

  function requestDeleteWorkout(workout: LocalWorkout) {
    const workoutSetCount = sets.filter(
      (set) => set.workoutId === workout.id && !set.deleted,
    ).length;
    const date = formatWorkoutConfirmationDate(workout.startedAt, locale);
    openConfirmation({
      steps: workoutDeletionSteps({
        date,
        locale,
        setCount: workoutSetCount,
        synced: workout.revision > 0,
      }),
      action: async () => {
        const current = await db.workouts.get(workout.id);
        if (current) await deleteWorkout(current);
      },
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
    openConfirmation({
      steps: [
        {
          title: tr(locale, 'Удалить замер?', 'Delete measurement?'),
          message: tr(
            locale,
            `Запись за ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(new Date(measurement.measuredOn))} исчезнет из истории после синхронизации.`,
            `The entry for ${new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date(measurement.measuredOn))} will disappear from history after syncing.`,
          ),
          confirmLabel: tr(locale, 'Удалить замер', 'Delete measurement'),
        },
      ],
      action: () => deleteMeasurement(measurement),
    });
  }

  function requestRemoveExercise(itemId: string, hasLoggedSets: boolean) {
    if (!hasLoggedSets) {
      void removeExercise(itemId);
      return;
    }
    openConfirmation({
      steps: [
        {
          title: tr(locale, 'Убрать упражнение из плана?', 'Remove exercise from plan?'),
          message: tr(
            locale,
            'Уже записанные подходы сохранятся в тренировке вне текущего плана.',
            'Logged sets will stay in the workout outside the current plan.',
          ),
          confirmLabel: tr(locale, 'Убрать из плана', 'Remove from plan'),
        },
      ],
      action: () => removeExercise(itemId),
    });
  }

  async function deleteCatalogExercise(exercise: Exercise) {
    try {
      const deleted = await softDeletePersonalExercise(exercise.id);
      await db.exercises.put(deleted);
      setExerciseDetailId(null);
    } catch {
      setInviteNotice(
        tr(
          locale,
          'Не удалось удалить упражнение из каталога. Проверь подключение и попробуй ещё раз.',
          'Could not remove the exercise from the catalog. Check your connection and try again.',
        ),
      );
    }
  }

  function requestDeleteCatalogExercise(exercise: Exercise) {
    openConfirmation({
      steps: [
        {
          title: tr(locale, 'Удалить из каталога?', 'Remove from catalog?'),
          message: tr(
            locale,
            'Упражнение исчезнет из каталога и новых вариантов замены. Подходы, тренировки и название в истории сохранятся. Это удаление, а не архивация.',
            'The exercise will disappear from the catalog and new replacement choices. Sets, workouts, and its name in history will stay. This is deletion, not archiving.',
          ),
          confirmLabel: tr(locale, 'Удалить из каталога', 'Remove from catalog'),
        },
      ],
      action: () => deleteCatalogExercise(exercise),
    });
  }

  async function requestLogoutWithSafety() {
    const [pendingMutations, conflictCount, voiceEntries] = await Promise.all([
      db.outbox.count(),
      db.conflicts.count(),
      db.voiceEntries.toArray(),
    ]);
    const risks: LogoutRisks = {
      pendingMutations,
      conflicts: conflictCount,
      localVoiceEntries: voiceEntries.filter(
        (entry) => !entry.serverStored && entry.status !== 'deleting',
      ).length,
      pendingVoiceDeletions: voiceEntries.filter((entry) => entry.status === 'deleting').length,
    };
    if (!hasLogoutRisks(risks)) {
      onLogout();
      return;
    }
    openConfirmation({
      steps: logoutConfirmationSteps(risks, locale),
      action: async () => {
        await onLogout();
      },
    });
  }

  function requestResolveSyncConflict(conflict: SyncConflict, strategy: 'server' | 'mine') {
    if (!conflictNeedsDoubleConfirmation(conflict, strategy)) {
      void resolveConflict(conflict.id, strategy);
      return;
    }
    const workout = workouts.find((item) => item.id === conflict.entityId);
    const workoutSetCount = sets.filter(
      (set) => set.workoutId === conflict.entityId && !set.deleted,
    ).length;
    openConfirmation({
      steps: missingServerWorkoutDeletionSteps({
        date: workout
          ? formatWorkoutConfirmationDate(workout.startedAt, locale)
          : tr(locale, 'Локальная тренировка', 'Local workout'),
        locale,
        setCount: workoutSetCount,
      }),
      action: () => resolveConflict(conflict.id, strategy),
    });
  }

  function confirmPendingAction() {
    if (!confirmation) return;
    const result = advanceConfirmation(confirmation);
    if (result.type === 'advance') {
      setConfirmation(result.confirmation);
      return;
    }
    setConfirmation(null);
    void result.action();
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
    const activityAt = new Date().toISOString();

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
          activityAt,
        },
      });
    }
    await recordLocalWorkoutActivity(set.workoutId, activityAt);
    await flushOutbox();
  }

  return (
    <main
      className={[
        'app-shell',
        `app-shell-${view}`,
        view === 'workout' && workoutContext && !exerciseDetail && 'app-shell-live',
        editingWorkout && 'app-shell-history-edit',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header className="topbar">
        <div>
          <p className="brand">MightyCringe</p>
          <p className="subtle">
            {tr(locale, 'Привет', 'Hi')}, {firstName(user.displayName, locale)} 👋
          </p>
        </div>
        <details
          className={conflicts.length ? 'sync-status conflict' : `sync-status ${syncStatus.phase}`}
          ref={syncStatusRef}
        >
          <summary
            aria-label={syncStatusLabel(syncStatus.phase, outboxCount, conflicts.length, locale)}
            title={lastSyncTitle(lastSuccessfulSyncAt, locale)}
          >
            <SyncStatusIcon
              conflicts={conflicts.length}
              pending={outboxCount}
              phase={syncStatus.phase}
            />
          </summary>
          <div className="sync-tooltip" role="status">
            <strong>
              {syncStatusLabel(syncStatus.phase, outboxCount, conflicts.length, locale)}
            </strong>
            <span>
              {syncStatusExplanation(syncStatus.phase, outboxCount, conflicts.length, locale)}
            </span>
            <small>{lastSyncTitle(lastSuccessfulSyncAt, locale)}</small>
            <button
              disabled={syncStatus.phase === 'syncing'}
              onClick={() => void syncAll()}
              type="button"
            >
              {tr(locale, 'Синхронизировать сейчас', 'Sync now')}
            </button>
          </div>
        </details>
      </header>

      <div className="app-content">
        {inviteNotice && (
          <p className="connectivity-notice" role="status">
            {inviteNotice}
          </p>
        )}

        {restoredFromCache ? (
          <p className="connectivity-notice" role="status">
            {tr(
              locale,
              'Открыта сохранённая копия. Можно продолжать тренировку — изменения останутся на этом устройстве и уйдут на сервер после восстановления связи.',
              'A saved copy is open. You can keep training — changes will stay on this device and sync when the connection returns.',
            )}
          </p>
        ) : syncStatus.phase === 'offline' ? (
          <p className="connectivity-notice" role="status">
            {tr(
              locale,
              'Нет сети. Все действия сохраняются на этом устройстве и синхронизируются позже.',
              'You are offline. Every action is saved on this device and will sync later.',
            )}
          </p>
        ) : syncStatus.phase === 'error' ? (
          <p className="connectivity-notice error" role="status">
            {syncStatus.message}{' '}
            {tr(
              locale,
              'Нажми статус справа вверху, чтобы повторить сейчас.',
              'Tap the status above to retry now.',
            )}
          </p>
        ) : null}

        {exerciseEditor ? (
          <ExerciseEditorView
            exercise={exerciseEditor}
            onClose={() => setExerciseEditor(null)}
            onSaved={async (exercise) => {
              await db.exercises.put(exercise);
            }}
          />
        ) : exerciseDetail ? (
          <ExerciseDetailView
            activeWorkout={workoutContext}
            exercise={exerciseDetail}
            preference={preferenceByExerciseId.get(exerciseDetail.id) ?? null}
            onAddSet={(exercise) => setSheet({ exercise, set: null })}
            onBack={() => setExerciseDetailId(null)}
            onDeleteSet={requestDeleteSet}
            onDeleteExercise={requestDeleteCatalogExercise}
            onEditExercise={setExerciseEditor}
            onEditSet={(exercise, set) => setSheet({ exercise, set })}
            onMoveSet={moveSet}
            onTogglePreference={(value) => toggleExercisePreference(exerciseDetail.id, value)}
            onReplaceExercise={() => {
              const target = workoutContext ? 'current' : 'draft';
              const item = (workoutContext?.exercises ?? draftPlan ?? []).find(
                (candidate) => candidate.exerciseId === exerciseDetail.id,
              );
              if (item) setExercisePicker({ target, mode: 'replace', itemId: item.id });
            }}
            sets={sets}
            workouts={workouts}
          />
        ) : (
          <>
            {view === 'workout' && (
              <WorkoutView
                activeWorkout={workoutContext}
                autoFinishedWorkout={autoFinishedWorkout}
                catalog={exercises}
                draftPlan={draftPlan ?? []}
                editingHistory={Boolean(editingWorkout)}
                favoriteWorkouts={favoriteWorkouts}
                inactivityState={inactivityState}
                onAddSet={(exercise) => setSheet({ exercise, set: null })}
                onAddExercise={() =>
                  setExercisePicker({ target: workoutContext ? 'current' : 'draft', mode: 'add' })
                }
                onDeleteSet={requestDeleteSet}
                onEditSet={(exercise, set) => setSheet({ exercise, set })}
                onFinish={requestFinishWorkout}
                onFinishNow={() => void finishWorkout('manual')}
                onFinishEditing={() => {
                  setEditingWorkoutId(null);
                  setView('progress');
                }}
                onDismissAutoFinish={() => void dismissAutoFinishNotice()}
                onEditTiming={(workout) => setTimingWorkoutId(workout.id)}
                onMoveExercise={(itemId, direction) =>
                  workoutContext
                    ? void moveExercise(itemId, direction)
                    : void moveDraftExercise(itemId, direction)
                }
                onMoveSet={moveSet}
                onOpenExercise={(exercise) => setExerciseDetailId(exercise.id)}
                onRemoveExercise={(itemId, hasLoggedSets) =>
                  workoutContext
                    ? requestRemoveExercise(itemId, hasLoggedSets)
                    : void removeDraftExercise(itemId)
                }
                onRemoveFavorite={requestToggleWorkoutFavorite}
                onRenameFavorite={requestEditWorkoutFavoriteName}
                onRepeatFavorite={requestRepeatWorkout}
                onReplaceExercise={(itemId) =>
                  setExercisePicker({
                    target: workoutContext ? 'current' : 'draft',
                    mode: 'replace',
                    itemId,
                  })
                }
                onResumeAutoFinished={() => {
                  if (autoFinishedWorkout) requestResumeWorkout(autoFinishedWorkout);
                }}
                onSaveNotes={updateWorkoutNotes}
                onStart={startWorkout}
                onStillTraining={() => void touchActiveWorkout()}
                onToggleSuperset={(itemId) =>
                  workoutContext ? void toggleSuperset(itemId) : void toggleDraftSuperset(itemId)
                }
                onDismissRecovery={() => setRecoveredWorkoutId(null)}
                recovered={activeWorkout?.id === recoveredWorkoutId}
                sets={sets}
              />
            )}
            {view === 'catalog' && (
              <CatalogView
                exercises={catalogChoices}
                onOpenExercise={(exercise) => setExerciseDetailId(exercise.id)}
                onTogglePreference={toggleExercisePreference}
                preferences={preferenceByExerciseId}
              />
            )}
            {view === 'progress' && (
              <ProgressView
                exercises={exercises}
                measurements={measurements}
                onDeleteMeasurement={requestDeleteMeasurement}
                onDeleteWorkout={requestDeleteWorkout}
                onEditWorkout={editCompletedWorkout}
                onImportMeasurements={importMeasurements}
                onEditFavoriteName={requestEditWorkoutFavoriteName}
                onRepeatWorkout={requestRepeatWorkout}
                onResumeWorkout={requestResumeWorkout}
                onSaveMeasurement={saveMeasurement}
                onToggleFavorite={requestToggleWorkoutFavorite}
                sets={sets}
                workouts={workouts}
              />
            )}
            {view === 'settings' && (
              <SettingsView
                conflicts={conflicts}
                onLogout={requestLogoutWithSafety}
                onOpenTrainer={
                  canUseTrainerConsole(user.role)
                    ? () => {
                        setExerciseDetailId(null);
                        setView('trainer');
                      }
                    : undefined
                }
                onResolveConflict={requestResolveSyncConflict}
                onUserUpdated={onUserUpdated}
                relationshipRefreshKey={relationshipRefreshKey}
                user={user}
              />
            )}
            {view === 'trainer' && <TrainerDashboard onBack={() => setView('settings')} />}
          </>
        )}
      </div>

      {view !== 'trainer' && !exerciseEditor && (
        <nav aria-label={tr(locale, 'Основная навигация', 'Primary navigation')} className="tabs">
          <Tab
            active={view === 'workout'}
            icon={<NavIcon name="workout" />}
            label={tr(locale, 'Тренировка', 'Workout')}
            onClick={() => {
              setExerciseDetailId(null);
              setView('workout');
            }}
          />
          <Tab
            active={view === 'progress'}
            icon={<NavIcon name="progress" />}
            label={tr(locale, 'Прогресс', 'Progress')}
            onClick={() => {
              setExerciseDetailId(null);
              setView('progress');
            }}
          />
          <button
            aria-expanded={Boolean(explainContext)}
            aria-label={tr(
              locale,
              'Пояснить подход или изменить тренировку',
              'Describe a set or change the workout',
            )}
            className={`tab explain-tab ${explainContext ? 'active' : ''}`}
            onClick={() => setExplainContext({ exercise: exerciseDetail })}
            type="button"
          >
            <span className="explain-orb">
              <NavIcon name="explain" />
              <i aria-hidden="true">✦</i>
            </span>
            <span className="tab-label">{tr(locale, 'Пояснить', 'Describe')}</span>
          </button>
          <Tab
            active={view === 'catalog'}
            icon={<NavIcon name="catalog" />}
            label={tr(locale, 'Каталог', 'Catalog')}
            onClick={() => {
              setExerciseDetailId(null);
              setView('catalog');
            }}
          />
          <Tab
            active={view === 'settings'}
            icon={<NavIcon name="settings" />}
            label={tr(locale, 'Настройки', 'Settings')}
            onClick={() => {
              setExerciseDetailId(null);
              setView('settings');
            }}
          />
        </nav>
      )}

      <SetSheet
        defaults={setDefaults}
        exercise={sheet?.exercise ?? null}
        initial={sheet?.set ?? null}
        onClose={() => setSheet(null)}
        onDelete={
          sheet?.set
            ? () => {
                requestDeleteSet(sheet.set!);
              }
            : null
        }
        onExplain={() => {
          if (!sheet) return;
          setExplainContext({ exercise: sheet.exercise });
          setSheet(null);
        }}
        onSave={saveSet}
      />
      <WorkoutTimingSheet
        onClose={() => setTimingWorkoutId(null)}
        onSave={(startedAt, durationSeconds) => {
          if (!timingWorkout) return;
          return saveWorkoutTiming(timingWorkout, startedAt, durationSeconds);
        }}
        workout={timingWorkout ?? null}
      />
      <WorkoutFavoriteNameSheet
        onClose={() => setFavoriteNameWorkoutId(null)}
        onSave={(workout, favoriteName) => updateWorkoutFavorite(workout, true, favoriteName)}
        workout={favoriteNameWorkout ?? null}
      />
      <ExercisePickerSheet
        catalog={catalogChoices}
        currentPlan={
          exercisePicker?.target === 'draft' ? (draftPlan ?? []) : (workoutContext?.exercises ?? [])
        }
        mode={exercisePicker}
        onChoose={chooseExercise}
        onClose={() => setExercisePicker(null)}
        preferences={preferenceByExerciseId}
      />
      <ConfirmationSheet
        confirmation={confirmation}
        onClose={() => setConfirmation(null)}
        onConfirm={confirmPendingAction}
      />
      {explainContext && (
        <ExplainSheet
          activeWorkout={workoutContext}
          catalog={availableExercises}
          onApplyCommand={executeWorkoutCommand}
          onClose={() => setExplainContext(null)}
          onSave={saveNaturalSet}
          onStartWorkout={async () => {
            await startWorkout();
            setExplainContext(null);
            setExerciseDetailId(null);
            setView('workout');
          }}
          scopedExercise={explainContext.exercise}
          sets={sets}
          preferences={preferenceByExerciseId}
        />
      )}
    </main>
  );
}

function AuthLoading() {
  const locale = publicLocale();
  return (
    <main className="auth-shell">
      <p className="brand">MightyCringe</p>
      <div className="auth-card" aria-live="polite">
        <p className="eyebrow">{tr(locale, 'Безопасный вход', 'Secure sign-in')}</p>
        <h1>{tr(locale, 'Проверяем сессию…', 'Checking your session…')}</h1>
      </div>
    </main>
  );
}

function SessionUnavailable({ onRetry }: { onRetry: () => void }) {
  const locale = publicLocale();
  return (
    <main className="auth-shell">
      <p className="brand">MightyCringe</p>
      <section className="auth-card" aria-live="assertive">
        <p className="eyebrow">{tr(locale, 'Безопасный запуск', 'Safe startup')}</p>
        <h1>{tr(locale, 'Не удалось открыть приложение', 'The app could not open')}</h1>
        <p className="intro">
          {tr(
            locale,
            'Локальные тренировки не удалялись. Закрой другие вкладки MightyCringe и попробуй ещё раз.',
            'Your local workouts were not deleted. Close other MightyCringe tabs and try again.',
          )}
        </p>
        <button className="button primary action" onClick={onRetry} type="button">
          {tr(locale, 'Повторить безопасно', 'Retry safely')}
        </button>
      </section>
    </main>
  );
}

function LoginScreen({
  googleEnabled,
  serverUnavailable,
  onRetry,
}: {
  googleEnabled: boolean;
  serverUnavailable: boolean;
  onRetry: () => void;
}) {
  const locale = publicLocale();
  const authError = new URLSearchParams(window.location.search).get('authError');
  const loginHref = `/api/v1/auth/google?returnTo=${encodeURIComponent(currentLoginReturnTo(window.location))}`;
  return (
    <main className="auth-shell">
      <p className="brand">MightyCringe</p>
      <section className="auth-card">
        <p className="eyebrow">{tr(locale, 'Личный журнал', 'Private log')}</p>
        <h1>{tr(locale, 'Твои тренировки — только твои', 'Your workouts stay yours')}</h1>
        <p className="intro">
          {tr(
            locale,
            'Войди через Google. Приложение получит только подтверждённый email, имя и аватар для профиля.',
            'Sign in with Google. The app receives only your verified email, name, and profile picture.',
          )}
        </p>
        {authError && (
          <p className="auth-error">
            {tr(
              locale,
              'Вход не завершён. Попробуй ещё раз.',
              'Sign-in was not completed. Try again.',
            )}
          </p>
        )}
        {serverUnavailable ? (
          <>
            <p className="auth-error">
              {tr(
                locale,
                'Сервер не ответил вовремя. Локальные данные сохранены; проверь интернет и повтори подключение.',
                'The server did not respond in time. Your local data is safe; check your connection and retry.',
              )}
            </p>
            <button className="button primary action" onClick={onRetry} type="button">
              {tr(locale, 'Повторить подключение', 'Retry connection')}
            </button>
          </>
        ) : googleEnabled ? (
          <a className="button primary action login-button" href={loginHref}>
            {tr(locale, 'Войти через Google', 'Sign in with Google')}
          </a>
        ) : (
          <button className="button primary action" disabled type="button">
            {tr(
              locale,
              'Google OAuth ещё не настроен владельцем',
              'Google OAuth has not been configured by the owner yet',
            )}
          </button>
        )}
        <p className="privacy-note">
          {tr(
            locale,
            'Сессия хранится в защищённой HttpOnly cookie. Токены Google не сохраняются в браузере.',
            'Your session uses a protected HttpOnly cookie. Google tokens are not stored in the browser.',
          )}
        </p>
      </section>
    </main>
  );
}

function WorkoutView({
  activeWorkout,
  autoFinishedWorkout,
  catalog,
  draftPlan,
  editingHistory,
  favoriteWorkouts,
  inactivityState,
  sets,
  onStart,
  onAddExercise,
  onAddSet,
  onDeleteSet,
  onEditSet,
  onFinish,
  onFinishNow,
  onFinishEditing,
  onDismissAutoFinish,
  onEditTiming,
  onMoveExercise,
  onMoveSet,
  onOpenExercise,
  onRemoveExercise,
  onRemoveFavorite,
  onRenameFavorite,
  onRepeatFavorite,
  onReplaceExercise,
  onResumeAutoFinished,
  onSaveNotes,
  onStillTraining,
  onToggleSuperset,
  recovered,
  onDismissRecovery,
}: {
  activeWorkout: LocalWorkout | undefined;
  autoFinishedWorkout: LocalWorkout | undefined;
  catalog: Exercise[];
  draftPlan: WorkoutExercise[];
  editingHistory: boolean;
  favoriteWorkouts: LocalWorkout[];
  inactivityState: WorkoutInactivityState;
  sets: LocalSet[];
  onStart: () => void;
  onAddExercise: () => void;
  onAddSet: (exercise: Exercise) => void;
  onDeleteSet: (set: LocalSet) => void;
  onEditSet: (exercise: Exercise, set: LocalSet) => void;
  onFinish: () => void;
  onFinishNow: () => void;
  onFinishEditing: () => void;
  onDismissAutoFinish: () => void;
  onEditTiming: (workout: LocalWorkout) => void;
  onMoveExercise: (itemId: string, direction: -1 | 1) => void;
  onMoveSet: (set: LocalSet, direction: -1 | 1) => void;
  onOpenExercise: (exercise: Exercise) => void;
  onRemoveExercise: (itemId: string, hasLoggedSets: boolean) => void;
  onRemoveFavorite: (workout: LocalWorkout) => void;
  onRenameFavorite: (workout: LocalWorkout) => void;
  onRepeatFavorite: (workout: LocalWorkout) => void;
  onReplaceExercise: (itemId: string) => void;
  onResumeAutoFinished: () => void;
  onSaveNotes: (workout: LocalWorkout, notes: string) => Promise<void>;
  onStillTraining: () => void;
  onToggleSuperset: (itemId: string) => void;
  recovered: boolean;
  onDismissRecovery: () => void;
}) {
  const { locale, unitSystem } = usePreferences();
  const [elapsedAt, setElapsedAt] = useState(() => Date.now());
  const [notesOpen, setNotesOpen] = useState(false);
  const [optionsItemId, setOptionsItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkout || editingHistory) return;
    const refreshElapsedAt = () => setElapsedAt(Date.now());
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshElapsedAt();
    };
    refreshElapsedAt();
    const interval = window.setInterval(refreshElapsedAt, 30_000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshElapsedAt);
    window.addEventListener('pageshow', refreshElapsedAt);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshElapsedAt);
      window.removeEventListener('pageshow', refreshElapsedAt);
    };
  }, [activeWorkout?.id, editingHistory]);

  if (!activeWorkout) {
    const autoFinishedSetCount = autoFinishedWorkout
      ? sets.filter((set) => set.workoutId === autoFinishedWorkout.id && !set.deleted).length
      : 0;
    const plan = [...draftPlan]
      .sort((left, right) => left.position - right.position)
      .flatMap((item) => {
        const exercise = catalog.find((candidate) => candidate.id === item.exerciseId);
        return exercise ? [{ item, exercise }] : [];
      });
    const optionsSelection = plan.find(({ item }) => item.id === optionsItemId) ?? null;
    const optionsIndex = optionsSelection
      ? plan.findIndex(({ item }) => item.id === optionsSelection.item.id)
      : -1;
    const displayGroups = groupWorkoutPlanForDisplay(plan);
    const displayGroupSizes = new Map(
      displayGroups.flatMap((group) =>
        group.supersetGroup === null ? [] : [[group.supersetGroup, group.entries.length] as const],
      ),
    );
    const renderDraftEntry = ({ item, exercise }: (typeof plan)[number]) => (
      <article
        className={[
          'exercise-card',
          'draft-exercise-card',
          item.supersetGroup === null ? '' : 'superset-member',
        ]
          .filter(Boolean)
          .join(' ')}
        key={item.id}
      >
        <div className="exercise-card-head">
          <button
            className="exercise-title-button"
            onClick={() => onOpenExercise(exercise)}
            type="button"
          >
            <strong>{exerciseName(exercise, locale)}</strong>
            <span className="exercise-card-meta">
              <small>{muscleLabel(exercise.primaryMuscles[0], locale)}</small>
              <Tag tag={exercise.tag} />
              {item.supersetGroup !== null && (
                <span className="superset-label">
                  {workoutGroupLabel(displayGroupSizes.get(item.supersetGroup) ?? 2, locale)}{' '}
                  {item.supersetGroup}
                </span>
              )}
            </span>
          </button>
          <button
            aria-label={`${tr(locale, 'Настроить упражнение', 'Exercise options')}: ${exerciseName(exercise, locale)}`}
            className="exercise-options-trigger"
            onClick={() => setOptionsItemId(item.id)}
            type="button"
          >
            •••
          </button>
        </div>
      </article>
    );
    return (
      <section className="screen">
        {autoFinishedWorkout && (
          <AutoFinishNotice
            onContinue={onResumeAutoFinished}
            onDismiss={onDismissAutoFinish}
            onEdit={() => onEditTiming(autoFinishedWorkout)}
            setCount={autoFinishedSetCount}
            workout={autoFinishedWorkout}
          />
        )}
        <div className="workout-plan-heading">
          <p className="eyebrow">{tr(locale, 'Сегодня', 'Today')}</p>
          <h1>{tr(locale, 'План на сегодня', "Today's plan")}</h1>
          <p>{formatExerciseCount(plan.length, locale)}</p>
        </div>
        <p className="intro workout-plan-intro">
          {tr(
            locale,
            'Проверь упражнения и связки. Таймер запустится только после старта.',
            'Review the exercises and groups. The timer begins only after you start.',
          )}
        </p>
        <button
          className="button primary action workout-plan-start"
          onClick={onStart}
          type="button"
        >
          {tr(locale, 'Начать тренировку', 'Start workout')}
        </button>
        <div className="exercise-list draft-plan-list">
          {displayGroups.map((group) => {
            if (group.supersetGroup === null) return renderDraftEntry(group.entries[0]);
            return (
              <section
                aria-label={`${workoutGroupLabel(group.entries.length, locale)} ${group.supersetGroup}`}
                className="superset-cluster"
                key={`draft-superset-${group.supersetGroup}`}
              >
                <div className="superset-cluster-items">{group.entries.map(renderDraftEntry)}</div>
              </section>
            );
          })}
          {!plan.length && (
            <div className="empty-plan">
              <strong>{tr(locale, 'План пока пуст', 'The plan is empty')}</strong>
              <span>
                {tr(
                  locale,
                  'Добавь упражнения перед началом — таймер ещё не идёт.',
                  'Add exercises before starting — the timer is not running yet.',
                )}
              </span>
            </div>
          )}
          <button className="button ghost full add-exercise" onClick={onAddExercise} type="button">
            ＋ {tr(locale, 'Добавить упражнение', 'Add exercise')}
          </button>
        </div>
        <FavoriteWorkoutsSection
          exercises={catalog}
          onRemove={onRemoveFavorite}
          onRename={onRenameFavorite}
          onRepeat={onRepeatFavorite}
          workouts={favoriteWorkouts}
        />
        <ExerciseOptionsSheet
          exercise={optionsSelection?.exercise ?? null}
          hasLoggedSets={false}
          index={optionsIndex}
          linkedWithNext={
            optionsSelection !== null &&
            optionsSelection.item.supersetGroup !== null &&
            optionsSelection.item.supersetGroup === plan[optionsIndex + 1]?.item.supersetGroup
          }
          onClose={() => setOptionsItemId(null)}
          onLink={() => {
            if (!optionsSelection) return;
            setOptionsItemId(null);
            onToggleSuperset(optionsSelection.item.id);
          }}
          onMove={(direction) => {
            if (!optionsSelection) return;
            setOptionsItemId(null);
            onMoveExercise(optionsSelection.item.id, direction);
          }}
          onRemove={() => {
            if (!optionsSelection) return;
            setOptionsItemId(null);
            onRemoveExercise(optionsSelection.item.id, false);
          }}
          onReplace={() => {
            if (!optionsSelection) return;
            setOptionsItemId(null);
            onReplaceExercise(optionsSelection.item.id);
          }}
          planLength={plan.length}
        />
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
  const optionsSelection = plan.find(({ item }) => item.id === optionsItemId) ?? null;
  const optionsIndex = optionsSelection
    ? plan.findIndex(({ item }) => item.id === optionsSelection.item.id)
    : -1;
  const displayGroups = groupWorkoutPlanForDisplay(plan);
  const displayGroupSizes = new Map(
    displayGroups.flatMap((group) =>
      group.supersetGroup === null ? [] : [[group.supersetGroup, group.entries.length] as const],
    ),
  );
  const renderPlanEntry = ({ item, exercise }: (typeof plan)[number]) => {
    const logged = visibleSets
      .filter((set) => set.exerciseId === exercise.id)
      .sort(
        (left, right) =>
          left.position - right.position || left.performedAt.localeCompare(right.performedAt),
      );

    return (
      <article
        className={[
          'exercise-card',
          item.supersetGroup === null ? '' : 'superset-member',
          logged.length ? 'has-sets' : 'no-sets',
        ]
          .filter(Boolean)
          .join(' ')}
        key={item.id}
      >
        <div className="exercise-card-head">
          <button
            className="exercise-title-button"
            onClick={() => onOpenExercise(exercise)}
            type="button"
          >
            <strong>{exerciseName(exercise, locale)}</strong>
            <span className="exercise-card-meta">
              <small>{muscleLabel(exercise.primaryMuscles[0], locale)}</small>
              <Tag tag={exercise.tag} />
              {item.supersetGroup !== null && (
                <span className="superset-label">
                  {workoutGroupLabel(displayGroupSizes.get(item.supersetGroup) ?? 2, locale)}{' '}
                  {item.supersetGroup}
                </span>
              )}
            </span>
          </button>
          <div className="exercise-card-actions">
            <button
              aria-label={`${tr(locale, 'Настроить упражнение', 'Exercise options')}: ${exerciseName(exercise, locale)}`}
              className="exercise-options-trigger"
              onClick={(event) => {
                event.stopPropagation();
                setOptionsItemId(item.id);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              type="button"
            >
              •••
            </button>
            <button className="add-set" onClick={() => onAddSet(exercise)} type="button">
              ＋ {tr(locale, 'Подход', 'Set')}
            </button>
          </div>
        </div>
        {logged.length ? (
          <div className="sets-line compact-set-list">
            {logged.map((set, setIndex) => (
              <button
                aria-label={`${tr(locale, 'Подход', 'Set')} ${setIndex + 1}: ${formatWeight(set.weightKg, locale, unitSystem)}, ${set.reps}, RIR ${set.rir ?? '—'}`}
                className={set.syncState === 'conflict' ? 'set-chip conflict' : 'set-chip'}
                key={set.id}
                onClick={() => onEditSet(exercise, set)}
                type="button"
              >
                {setIndex + 1}. {formatWeight(set.weightKg, locale, unitSystem)} × {set.reps}
                {set.rir === null ? '' : ` · R${set.rir}`}
              </button>
            ))}
          </div>
        ) : (
          <p className="sets-line muted">{tr(locale, 'Ещё нет подходов', 'No sets yet')}</p>
        )}
      </article>
    );
  };

  return (
    <section
      className={
        editingHistory ? 'screen workout-live workout-history-edit' : 'screen workout-live'
      }
    >
      <div className="section-head live-head">
        <div>
          <p className="eyebrow">
            {editingHistory
              ? tr(locale, 'Редактирование истории', 'Editing history')
              : tr(locale, 'Тренировка идёт', 'Workout in progress')}
          </p>
          <h1>
            {editingHistory
              ? new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(activeWorkout.startedAt))
              : formatLiveWorkoutDurationSeconds(
                  displayedWorkoutDurationSeconds(activeWorkout, elapsedAt),
                  locale,
                )}
          </h1>
        </div>
        <button
          className="button ghost small"
          onClick={editingHistory ? onFinishEditing : onFinish}
          type="button"
        >
          {editingHistory ? tr(locale, 'Готово', 'Done') : tr(locale, 'Завершить', 'Finish')}
        </button>
      </div>
      <details className="live-help">
        <summary>
          {editingHistory
            ? tr(locale, 'Правки не возобновляют тренировку', 'Edits do not resume the workout')
            : tr(locale, 'План можно менять', 'The plan is editable')}
        </summary>
        <p>
          {editingHistory
            ? tr(
                locale,
                'Можно исправлять план, подходы, дату начала и длительность.',
                'You can correct the plan, sets, start date, and duration.',
              )
            : tr(
                locale,
                'Переставляй, заменяй и убирай упражнения. Уже записанные подходы останутся в истории.',
                'Move, replace, or remove exercises. Logged sets will remain in your history.',
              )}
        </p>
      </details>
      {editingHistory && activeWorkout.endedAt && (
        <div className="workout-timing-summary">
          <div>
            <span>{tr(locale, 'Начало', 'Started')}</span>
            <strong>
              {new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(activeWorkout.startedAt))}
            </strong>
          </div>
          <div>
            <span>{tr(locale, 'Длительность', 'Duration')}</span>
            <strong>{formatWorkoutDurationSeconds(activeWorkout.durationSeconds, locale)}</strong>
          </div>
          <button
            className="button ghost small"
            onClick={() => onEditTiming(activeWorkout)}
            type="button"
          >
            {tr(locale, 'Исправить дату и время', 'Edit date and time')}
          </button>
        </div>
      )}
      {!editingHistory && (
        <WorkoutInactivityBanner
          onContinue={onStillTraining}
          onFinish={onFinishNow}
          state={inactivityState}
        />
      )}
      {recovered && !editingHistory && (
        <div className="recovery-notice" role="status">
          <div>
            <strong>
              {tr(locale, 'Незавершённая тренировка восстановлена', 'Unfinished workout restored')}
            </strong>
            <span>
              {tr(
                locale,
                'План и все записанные подходы загружены с этого устройства.',
                'The plan and all logged sets were restored from this device.',
              )}
            </span>
          </div>
          <button
            aria-label={tr(locale, 'Скрыть уведомление', 'Dismiss notice')}
            onClick={onDismissRecovery}
            type="button"
          >
            ×
          </button>
        </div>
      )}
      <div className="exercise-list">
        {displayGroups.map((group) => {
          if (group.supersetGroup === null) return renderPlanEntry(group.entries[0]);
          const groupLabel = `${workoutGroupLabel(group.entries.length, locale)} ${group.supersetGroup}`;
          return (
            <section
              aria-label={groupLabel}
              className="superset-cluster"
              key={`superset-${group.supersetGroup}`}
            >
              <div className="superset-cluster-items">{group.entries.map(renderPlanEntry)}</div>
            </section>
          );
        })}
        {!plan.length && (
          <div className="empty-plan">
            <strong>{tr(locale, 'План пока пуст', 'The plan is empty')}</strong>
            <span>
              {tr(
                locale,
                'Добавь первое упражнение — подходы сохраняются и офлайн.',
                'Add the first exercise — sets are saved offline too.',
              )}
            </span>
          </div>
        )}
        <button
          className="button ghost full add-exercise workout-list-action"
          onClick={onAddExercise}
          type="button"
        >
          <span aria-hidden="true" className="workout-list-action-icon">
            ＋
          </span>
          <span>{tr(locale, 'Добавить упражнение', 'Add exercise')}</span>
        </button>
        <button
          className="button ghost full workout-list-action workout-notes-trigger"
          onClick={() => setNotesOpen(true)}
          type="button"
        >
          <span aria-hidden="true" className="workout-list-action-icon">
            ✎
          </span>
          <span>{tr(locale, 'Комментарий по тренировке', 'Workout note')}</span>
        </button>
        {removedExerciseIds.length > 0 && (
          <div className="removed-sets">
            <p className="eyebrow">
              {tr(locale, 'Выполнено вне текущего плана', 'Completed outside the current plan')}
            </p>
            {removedExerciseIds.map((exerciseId) => {
              const exercise = catalog.find((candidate) => candidate.id === exerciseId);
              const logged = visibleSets
                .filter((set) => set.exerciseId === exerciseId)
                .sort((left, right) => left.position - right.position);
              if (!exercise) return null;
              return (
                <div className="removed-set-summary" key={exerciseId}>
                  <strong>{exerciseName(exercise, locale)}</strong>
                  {logged.map((set, index) => (
                    <div className="set-row" key={set.id}>
                      <button
                        className="set-chip"
                        onClick={() => onEditSet(exercise, set)}
                        type="button"
                      >
                        {index + 1}. {formatWeight(set.weightKg, locale, unitSystem)} × {set.reps}
                        {setEntrySourceSuffix(set.entrySource, locale)}
                      </button>
                      <div className="set-controls">
                        <button
                          aria-label={tr(locale, 'Переместить подход влево', 'Move set left')}
                          disabled={index === 0}
                          onClick={() => onMoveSet(set, -1)}
                          type="button"
                        >
                          ←
                        </button>
                        <button
                          aria-label={tr(locale, 'Переместить подход вправо', 'Move set right')}
                          disabled={index === logged.length - 1}
                          onClick={() => onMoveSet(set, 1)}
                          type="button"
                        >
                          →
                        </button>
                        <button
                          aria-label={tr(locale, 'Удалить подход', 'Delete set')}
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
      <ExerciseOptionsSheet
        exercise={optionsSelection?.exercise ?? null}
        hasLoggedSets={
          optionsSelection
            ? visibleSets.some((set) => set.exerciseId === optionsSelection.exercise.id)
            : false
        }
        index={optionsIndex}
        linkedWithNext={
          optionsSelection !== null &&
          optionsSelection.item.supersetGroup !== null &&
          optionsSelection.item.supersetGroup === plan[optionsIndex + 1]?.item.supersetGroup
        }
        onClose={() => setOptionsItemId(null)}
        onLink={() => {
          if (!optionsSelection) return;
          setOptionsItemId(null);
          void onToggleSuperset(optionsSelection.item.id);
        }}
        onMove={(direction) => {
          if (!optionsSelection) return;
          setOptionsItemId(null);
          void onMoveExercise(optionsSelection.item.id, direction);
        }}
        onRemove={() => {
          if (!optionsSelection) return;
          setOptionsItemId(null);
          onRemoveExercise(
            optionsSelection.item.id,
            visibleSets.some((set) => set.exerciseId === optionsSelection.exercise.id),
          );
        }}
        onReplace={() => {
          if (!optionsSelection) return;
          setOptionsItemId(null);
          onReplaceExercise(optionsSelection.item.id);
        }}
        planLength={plan.length}
      />
      <WorkoutNotesSheet
        onClose={() => setNotesOpen(false)}
        onSave={onSaveNotes}
        workout={notesOpen ? activeWorkout : null}
      />
    </section>
  );
}

function ExerciseOptionsSheet({
  exercise,
  index,
  planLength,
  linkedWithNext,
  hasLoggedSets,
  onClose,
  onMove,
  onReplace,
  onLink,
  onRemove,
}: {
  exercise: Exercise | null;
  index: number;
  planLength: number;
  linkedWithNext: boolean;
  hasLoggedSets: boolean;
  onClose: () => void;
  onMove: (direction: -1 | 1) => void;
  onReplace: () => void;
  onLink: () => void;
  onRemove: () => void;
}) {
  const { locale } = usePreferences();

  useEffect(() => {
    if (!exercise) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [exercise]);

  if (!exercise) return null;

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={`${tr(locale, 'Действия с упражнением', 'Exercise actions')}: ${exerciseName(exercise, locale)}`}
        aria-modal="true"
        className="sheet exercise-actions-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="sheet-handle" />
        <p className="eyebrow">{tr(locale, 'Упражнение', 'Exercise')}</p>
        <h2>{exerciseName(exercise, locale)}</h2>
        <div className="exercise-actions-grid">
          <button disabled={index <= 0} onClick={() => onMove(-1)} type="button">
            <span aria-hidden="true">↑</span>
            {tr(locale, 'Поднять выше', 'Move up')}
          </button>
          <button
            disabled={index < 0 || index >= planLength - 1}
            onClick={() => onMove(1)}
            type="button"
          >
            <span aria-hidden="true">↓</span>
            {tr(locale, 'Опустить ниже', 'Move down')}
          </button>
          <button onClick={onReplace} type="button">
            <span aria-hidden="true">↻</span>
            {tr(locale, 'Заменить', 'Replace')}
          </button>
          {index >= 0 && index < planLength - 1 && (
            <button onClick={onLink} type="button">
              <span aria-hidden="true">{linkedWithNext ? '⌁' : '⛓'}</span>
              {linkedWithNext
                ? tr(locale, 'Разделить связку здесь', 'Split group here')
                : tr(locale, 'Связать со следующим', 'Link with next')}
            </button>
          )}
          <button className="danger-action" onClick={onRemove} type="button">
            <span aria-hidden="true">×</span>
            {hasLoggedSets
              ? tr(locale, 'Убрать, сохранив подходы', 'Remove, keep sets')
              : tr(locale, 'Убрать из тренировки', 'Remove from workout')}
          </button>
        </div>
        <button className="button ghost full" onClick={onClose} type="button">
          {tr(locale, 'Отмена', 'Cancel')}
        </button>
      </section>
    </div>
  );
}

function ExerciseDetailView({
  exercise,
  activeWorkout,
  sets,
  workouts,
  onBack,
  onAddSet,
  onEditSet,
  onMoveSet,
  onDeleteSet,
  onDeleteExercise,
  onEditExercise,
  onReplaceExercise,
  onTogglePreference,
  preference,
}: {
  exercise: Exercise;
  activeWorkout: LocalWorkout | undefined;
  sets: LocalSet[];
  workouts: LocalWorkout[];
  onBack: () => void;
  onAddSet: (exercise: Exercise) => void;
  onEditSet: (exercise: Exercise, set: LocalSet) => void;
  onMoveSet: (set: LocalSet, direction: -1 | 1) => void;
  onDeleteSet: (set: LocalSet) => void;
  onDeleteExercise: (exercise: Exercise) => void;
  onEditExercise: (exercise: Exercise) => void;
  onReplaceExercise: () => void;
  onTogglePreference: (value: ExercisePreferenceValue) => Promise<void>;
  preference: ExercisePreferenceValue | null;
}) {
  const { locale, unitSystem } = usePreferences();
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [enriching, setEnriching] = useState(false);
  useEffect(() => {
    setVideoPlaying(false);
    setEnriching(false);
  }, [exercise.id]);
  const currentSets = activeWorkout
    ? sets
        .filter(
          (set) =>
            set.workoutId === activeWorkout.id && set.exerciseId === exercise.id && !set.deleted,
        )
        .sort((left, right) => left.position - right.position)
    : [];
  const previous = workouts
    .filter((workout) => workout.id !== activeWorkout?.id && workout.endedAt !== null)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .flatMap((workout) => {
      const workoutSets = sets
        .filter(
          (set) => set.workoutId === workout.id && set.exerciseId === exercise.id && !set.deleted,
        )
        .sort((left, right) => left.position - right.position);
      return workoutSets.length ? [{ workout, sets: workoutSets }] : [];
    })
    .slice(0, 4);
  const canAddSet = Boolean(
    activeWorkout?.exercises.some((item) => item.exerciseId === exercise.id),
  );
  const primaryVideo = exercise.videos?.[0] ?? null;
  const alternativeVideos = exercise.videos?.slice(1) ?? [];
  const primaryVideoId = primaryVideo ? youtubeVideoId(primaryVideo.url) : null;
  const fallbackVideoUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    `${exerciseName(exercise, locale)} техника выполнения`,
  )}`;

  return (
    <section className="screen exercise-detail-screen">
      <button className="detail-back" onClick={onBack} type="button">
        ←{' '}
        {activeWorkout
          ? tr(locale, 'К тренировке', 'Back to workout')
          : tr(locale, 'Назад', 'Back')}
      </button>
      <div className="exercise-detail-title">
        <div>
          <p className="eyebrow">{tr(locale, 'Упражнение', 'Exercise')}</p>
          <h1>{exerciseName(exercise, locale)}</h1>
        </div>
        <Tag tag={exercise.tag} />
      </div>
      <div className="exercise-detail-meta">
        <span>
          {exercise.primaryMuscles.map((muscle) => muscleLabel(muscle, locale)).join(', ')}
        </span>
        <span>{exercise.equipment.join(', ')}</span>
      </div>
      <ExercisePreferenceControls
        className="exercise-detail-preferences"
        onToggle={onTogglePreference}
        value={preference}
      />
      {exercise.scope === 'user' && (
        <div className="personal-exercise-actions">
          {exercise.deletedAt ? (
            <span>
              {tr(locale, 'Удалено из личного каталога', 'Removed from personal catalog')}
            </span>
          ) : (
            <>
              <button
                className="button primary small"
                onClick={() => setEnriching((value) => !value)}
                type="button"
              >
                {tr(
                  locale,
                  'Найти и заполнить информацией из интернета',
                  'Find and fill details from the internet',
                )}
              </button>
              <button
                className="button ghost small"
                onClick={() => onEditExercise(exercise)}
                type="button"
              >
                {tr(locale, 'Исправить данные', 'Edit details')}
              </button>
              <button
                className="button danger small"
                onClick={() => onDeleteExercise(exercise)}
                type="button"
              >
                {tr(locale, 'Удалить из каталога', 'Remove from catalog')}
              </button>
            </>
          )}
        </div>
      )}
      {enriching && exercise.scope === 'user' && !exercise.deletedAt && (
        <ExerciseEnrichmentPanel exercise={exercise} onClose={() => setEnriching(false)} />
      )}

      <section className="exercise-detail-section">
        <div className="section-head">
          <h2>{tr(locale, 'Подходы сегодня', "Today's sets")}</h2>
          {canAddSet && (
            <button className="add-set" onClick={() => onAddSet(exercise)} type="button">
              ＋ {tr(locale, 'Подход', 'Set')}
            </button>
          )}
        </div>
        {currentSets.length ? (
          <div className="detail-set-list">
            {currentSets.map((set, index) => (
              <article className="detail-set" key={set.id}>
                <button onClick={() => onEditSet(exercise, set)} type="button">
                  <strong>
                    {index + 1}. {formatWeight(set.weightKg, locale, unitSystem)} × {set.reps}
                    {set.rir === null ? '' : ` · RIR ${set.rir}`}
                  </strong>
                  <small>
                    {set.comment || tr(locale, 'Без комментария', 'No comment')}
                    {setEntrySourceSuffix(set.entrySource, locale)}
                  </small>
                </button>
                <div className="set-controls">
                  <button
                    aria-label={tr(locale, 'Переместить подход вверх', 'Move set up')}
                    disabled={index === 0}
                    onClick={() => onMoveSet(set, -1)}
                    type="button"
                  >
                    ↑
                  </button>
                  <button
                    aria-label={tr(locale, 'Переместить подход вниз', 'Move set down')}
                    disabled={index === currentSets.length - 1}
                    onClick={() => onMoveSet(set, 1)}
                    type="button"
                  >
                    ↓
                  </button>
                  <button
                    aria-label={tr(locale, 'Удалить подход', 'Delete set')}
                    className="danger-text"
                    onClick={() => onDeleteSet(set)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="detail-empty">
            {tr(locale, 'В этой тренировке подходов ещё нет.', 'No sets in this workout yet.')}
          </p>
        )}
      </section>

      <section className="exercise-detail-section">
        <h2>{tr(locale, 'Предыдущие результаты', 'Previous results')}</h2>
        {previous.length ? (
          <div className="previous-workouts">
            {previous.map(({ workout, sets: workoutSets }) => (
              <article key={workout.id}>
                <time dateTime={workout.startedAt}>
                  {new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  }).format(new Date(workout.startedAt))}
                </time>
                <div>
                  {workoutSets.map((set) => (
                    <span key={set.id}>
                      {formatWeight(set.weightKg, locale, unitSystem)} × {set.reps}
                      {set.rir === null ? '' : ` · R${set.rir}`}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="detail-empty">
            {tr(locale, 'Предыдущих подходов пока нет.', 'No previous sets yet.')}
          </p>
        )}
      </section>

      <section className="exercise-detail-section technique-section">
        <div className="section-head">
          <h2>{tr(locale, 'Видео с техникой', 'Technique video')}</h2>
          {primaryVideo && <span>{tr(locale, 'основное видео', 'main video')}</span>}
        </div>
        {exercise.notes && <p>{exercise.notes}</p>}
        {primaryVideo ? (
          <>
            {primaryVideoId && videoPlaying ? (
              <div className="technique-player">
                <iframe
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  src={`https://www.youtube-nocookie.com/embed/${primaryVideoId}?autoplay=1&rel=0`}
                  title={primaryVideo.title}
                />
              </div>
            ) : primaryVideoId ? (
              <button
                aria-label={tr(
                  locale,
                  `Запустить видео: ${primaryVideo.title}`,
                  `Play video: ${primaryVideo.title}`,
                )}
                className="technique-preview"
                onClick={() => setVideoPlaying(true)}
                type="button"
              >
                <img
                  alt={tr(
                    locale,
                    `Превью видео: ${primaryVideo.title}`,
                    `Video preview: ${primaryVideo.title}`,
                  )}
                  loading="lazy"
                  src={`https://i.ytimg.com/vi/${primaryVideoId}/hqdefault.jpg`}
                />
                <span className="technique-play" aria-hidden="true">
                  ▶
                </span>
                <strong>{primaryVideo.title}</strong>
              </button>
            ) : (
              <a
                className="technique-preview"
                href={primaryVideo.url}
                rel="noreferrer"
                target="_blank"
              >
                <span className="technique-preview-art" aria-hidden="true">
                  {exerciseName(exercise, locale).slice(0, 1)}
                </span>
                <span className="technique-play" aria-hidden="true">
                  ↗
                </span>
                <strong>{primaryVideo.title}</strong>
              </a>
            )}
            <div className="technique-video-actions">
              <a href={primaryVideo.url} rel="noreferrer" target="_blank">
                <span aria-hidden="true">↗</span>
                {tr(locale, 'Открыть видео', 'Open video')}
              </a>
              <a href={fallbackVideoUrl} rel="noreferrer" target="_blank">
                <span aria-hidden="true">⌕</span>
                {tr(locale, 'Найти другие', 'Find others')}
              </a>
            </div>
          </>
        ) : (
          <a
            className="technique-preview technique-preview-fallback"
            href={fallbackVideoUrl}
            rel="noreferrer"
            target="_blank"
          >
            <span className="technique-preview-art" aria-hidden="true">
              {exerciseName(exercise, locale).slice(0, 1)}
            </span>
            <span className="technique-play" aria-hidden="true">
              ▶
            </span>
            <strong>{tr(locale, 'Видео ещё не закреплено', 'No featured video yet')}</strong>
            <small>{tr(locale, 'Подобрать на YouTube', 'Browse YouTube')}</small>
          </a>
        )}
        {alternativeVideos.length > 0 && (
          <div className="technique-links">
            {alternativeVideos.map((video) => (
              <a href={video.url} key={video.url} rel="noreferrer" target="_blank">
                <span aria-hidden="true">▶</span>
                {video.title}
              </a>
            ))}
          </div>
        )}
      </section>

      {canAddSet && (
        <div
          aria-label={tr(locale, 'Действия в текущей тренировке', 'Current workout actions')}
          className="exercise-detail-actions"
          role="group"
        >
          <span className="exercise-detail-actions-label">
            {tr(locale, 'В текущей тренировке', 'In this workout')}
          </span>
          <button className="button ghost" onClick={onReplaceExercise} type="button">
            ↻ {tr(locale, 'Заменить', 'Replace')}
          </button>
          <button className="button primary" onClick={() => onAddSet(exercise)} type="button">
            ＋ {tr(locale, 'Подход', 'Set')}
          </button>
        </div>
      )}
    </section>
  );
}

function CatalogView({
  exercises,
  onOpenExercise,
  onTogglePreference,
  preferences,
}: {
  exercises: Exercise[];
  onOpenExercise: (exercise: Exercise) => void;
  onTogglePreference: (exerciseId: string, value: ExercisePreferenceValue) => Promise<void>;
  preferences: ReadonlyMap<string, ExercisePreferenceValue | null>;
}) {
  const { locale } = usePreferences();
  const [showAddOptions, setShowAddOptions] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState<Exercise['primaryMuscles'][number] | 'all'>(
    'all',
  );
  const [selectedTag, setSelectedTag] = useState<Exercise['tag'] | 'all'>('all');
  const [selectedPreference, setSelectedPreference] = useState<
    ExercisePreferenceValue | 'unmarked' | 'all'
  >('all');
  const filteredExercises = filterExerciseCatalog(
    exercises,
    {
      query,
      muscle: selectedMuscle,
      tag: selectedTag,
      preference: selectedPreference,
    },
    preferences,
  );
  const unresolvedCatalogQuery = catalogDiscoveryQuery(exercises, query);
  const hasFilters =
    query.trim() !== '' ||
    selectedMuscle !== 'all' ||
    selectedTag !== 'all' ||
    selectedPreference !== 'all';
  const activeFilterDescription = [
    query.trim() ? tr(locale, `поиск «${query.trim()}»`, `search “${query.trim()}”`) : null,
    selectedMuscle !== 'all'
      ? tr(
          locale,
          `мышца «${muscleLabel(selectedMuscle, locale)}»`,
          `muscle “${muscleLabel(selectedMuscle, locale)}”`,
        )
      : null,
    selectedTag !== 'all' ? `tag “${selectedTag}”` : null,
    selectedPreference !== 'all'
      ? tr(
          locale,
          `отношение «${preferenceFilterLabel(selectedPreference, locale)}»`,
          `preference “${preferenceFilterLabel(selectedPreference, locale)}”`,
        )
      : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <section className="screen">
      <p className="eyebrow">{tr(locale, 'Общий + личный', 'Shared + personal')}</p>
      <h1>{tr(locale, 'Каталог упражнений', 'Exercise catalog')}</h1>
      <div className="catalog-filters">
        <label>
          <span>
            {tr(locale, 'Название, синоним или группа мышц', 'Name, alias, or muscle group')}
          </span>
          <input
            onChange={(event) => {
              setQuery(event.target.value);
              setShowAddOptions(false);
            }}
            placeholder={tr(locale, 'Например: задняя дельта', 'For example: rear delt')}
            type="search"
            value={query}
          />
        </label>
        {(unresolvedCatalogQuery || (showAddOptions && query.trim().length >= 2)) && (
          <ExerciseAddPanel
            existingExercises={exercises}
            hasMatches={!unresolvedCatalogQuery}
            locale={locale}
            onExerciseSaved={async (exercise) => {
              await cacheExercise(exercise);
            }}
            query={unresolvedCatalogQuery ?? query}
          />
        )}
        {!unresolvedCatalogQuery &&
          !showAddOptions &&
          query.trim().length >= 2 &&
          filteredExercises.length > 0 && (
            <KeyboardSafeButton
              className="catalog-add-alternative"
              onPress={() => setShowAddOptions(true)}
              type="button"
            >
              {tr(
                locale,
                'Не то упражнение? Создать новое или найти в интернете',
                'Not the right exercise? Create a new one or search online',
              )}
            </KeyboardSafeButton>
          )}
        <div
          aria-label={tr(locale, 'Личное отношение', 'Personal preference')}
          className="catalog-filter-chips"
        >
          {(['all', 'like', 'dislike', 'unmarked'] as const).map((value) => (
            <CatalogFilterChip
              active={selectedPreference === value}
              key={value}
              label={preferenceFilterLabel(value, locale)}
              onClick={() => setSelectedPreference(value)}
            />
          ))}
        </div>
        <div
          aria-label={tr(locale, 'Характер упражнения', 'Exercise tag')}
          className="catalog-filter-chips"
        >
          <CatalogFilterChip
            active={selectedTag === 'all'}
            label={tr(locale, 'Любой характер', 'Any tag')}
            onClick={() => setSelectedTag('all')}
          />
          {exerciseTags.map((tag) => (
            <CatalogFilterChip
              active={selectedTag === tag}
              key={tag}
              label={tag === 'mighty' ? '⚡ Mighty' : tag === 'cringe' ? '😬 Cringe' : '• Normal'}
              onClick={() => setSelectedTag(tag)}
            />
          ))}
        </div>
        <div
          aria-label={tr(locale, 'Основная группа мышц', 'Primary muscle group')}
          className="catalog-filter-chips"
        >
          <CatalogFilterChip
            active={selectedMuscle === 'all'}
            label={tr(locale, 'Все мышцы', 'All muscles')}
            onClick={() => setSelectedMuscle('all')}
          />
          {muscleGroups.map((muscle) => (
            <CatalogFilterChip
              active={selectedMuscle === muscle}
              key={muscle}
              label={muscleLabel(muscle, locale)}
              onClick={() => setSelectedMuscle(muscle)}
            />
          ))}
        </div>
        <div className="catalog-filter-summary">
          <span>
            {tr(
              locale,
              `Найдено: ${filteredExercises.length}`,
              `Found: ${filteredExercises.length}`,
            )}
          </span>
          {hasFilters && (
            <button
              onClick={() => {
                setQuery('');
                setSelectedMuscle('all');
                setSelectedTag('all');
                setSelectedPreference('all');
                setShowAddOptions(false);
              }}
              type="button"
            >
              {tr(locale, 'Сбросить', 'Clear')}
            </button>
          )}
        </div>
      </div>
      <div className="exercise-list catalog-list">
        {filteredExercises.map((exercise) => (
          <article className="exercise-row catalog catalog-exercise-row" key={exercise.id}>
            <button
              className="catalog-exercise-link"
              onClick={() => onOpenExercise(exercise)}
              type="button"
            >
              <span className="catalog-symbol">
                {exercise.tag === 'mighty' ? '⚡' : exercise.tag === 'cringe' ? '😬' : '•'}
              </span>
              <div>
                <strong title={exerciseName(exercise, locale)}>
                  {exerciseName(exercise, locale)}
                </strong>
                <small>
                  {locale === 'en' ? exercise.nameRu : exercise.nameEn} ·{' '}
                  {muscleLabel(exercise.primaryMuscles[0], locale)}
                  {exercise.scope === 'user' ? ` · ${tr(locale, 'личное', 'personal')}` : ''}
                </small>
              </div>
              <span className="catalog-row-end">
                <Tag tag={exercise.tag} />
                <span aria-hidden="true" className="catalog-chevron">
                  →
                </span>
              </span>
            </button>
            <ExercisePreferenceControls
              compact
              onToggle={(value) => onTogglePreference(exercise.id, value)}
              value={preferences.get(exercise.id) ?? null}
            />
          </article>
        ))}
        {filteredExercises.length === 0 && !unresolvedCatalogQuery && (
          <div className="catalog-empty">
            <strong>{tr(locale, 'Ничего не найдено', 'Nothing found')}</strong>
            <p>
              {tr(
                locale,
                `Активные условия: ${activeFilterDescription || 'нет'}. Попробуй другой синоним, мышцу или сбрось фильтры.`,
                `Active conditions: ${activeFilterDescription || 'none'}. Try another alias or muscle, or clear the filters.`,
              )}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function ExercisePickerSheet({
  catalog,
  currentPlan,
  mode,
  onChoose,
  onClose,
  preferences,
}: {
  catalog: Exercise[];
  currentPlan: WorkoutExercise[];
  mode: ExercisePickerMode | null;
  onChoose: (exercise: Exercise) => Promise<void>;
  onClose: () => void;
  preferences: ReadonlyMap<string, ExercisePreferenceValue | null>;
}) {
  const { locale } = usePreferences();
  const [query, setQuery] = useState('');
  const [showAddOptions, setShowAddOptions] = useState(false);
  const [choosingExerciseId, setChoosingExerciseId] = useState<string | null>(null);
  const choosingExercise = useRef(false);

  useEffect(() => {
    setQuery('');
    setShowAddOptions(false);
    setChoosingExerciseId(null);
    choosingExercise.current = false;
  }, [mode]);
  if (!mode) return null;

  const replacedItemId = mode.mode === 'replace' ? mode.itemId : null;
  const replacedExercise =
    mode.mode === 'replace'
      ? catalog.find(
          (exercise) =>
            exercise.id === currentPlan.find((item) => item.id === replacedItemId)?.exerciseId,
        )
      : null;
  const unavailableIds = new Set(currentPlan.map((item) => item.exerciseId));
  const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
  const { explicitDislikedOptions, matchingCatalog, options } = replacementExerciseOptions({
    exercises: catalog,
    mode: mode.mode,
    preferences,
    query,
    unavailableIds,
  });
  const hiddenDislikedCount = catalog.filter(
    (exercise) => !unavailableIds.has(exercise.id) && preferences.get(exercise.id) === 'dislike',
  ).length;
  const optionGroups = groupExerciseChoicesByPrimaryMuscle(
    options,
    replacedExercise?.primaryMuscles[0] ?? null,
    locale,
    mode.mode === 'replace' ? preferences : new Map(),
    query,
  );

  function chooseOnce(exercise: Exercise) {
    if (choosingExercise.current) return;
    choosingExercise.current = true;
    setChoosingExerciseId(exercise.id);
    void onChoose(exercise).catch(() => {
      choosingExercise.current = false;
      setChoosingExerciseId(null);
    });
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={
          mode.mode === 'add'
            ? tr(locale, 'Добавить упражнение', 'Add exercise')
            : tr(locale, 'Заменить упражнение', 'Replace exercise')
        }
        aria-modal="true"
        className="sheet exercise-picker"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="sheet-handle" />
        <p className="eyebrow">
          {mode.mode === 'add'
            ? tr(locale, 'Каталог', 'Catalog')
            : tr(locale, 'Замена упражнения', 'Exercise replacement')}
        </p>
        <h2>
          {mode.mode === 'add'
            ? tr(locale, 'Добавить упражнение', 'Add exercise')
            : tr(locale, 'Замена упражнения', 'Replace exercise')}
        </h2>
        {mode.mode === 'replace' && replacedExercise && (
          <div className="replacement-flow">
            <div className="replacement-field replacement-source">
              <span>{tr(locale, 'Что заменить', 'What to replace')}</span>
              <strong>{exerciseName(replacedExercise, locale)}</strong>
            </div>
            <span aria-hidden="true" className="replacement-arrow">
              ↓
            </span>
            <div className="replacement-target-label">
              <span>{tr(locale, 'На что заменить', 'Replace with')}</span>
              <small>
                {tr(locale, 'Найди и выбери новое упражнение', 'Find and choose the new exercise')}
              </small>
            </div>
          </div>
        )}
        <input
          autoFocus
          className="exercise-search"
          onChange={(event) => {
            setQuery(event.target.value);
            setShowAddOptions(false);
          }}
          placeholder={
            mode.mode === 'add'
              ? tr(locale, 'Название, синоним или мышца', 'Name, alias, or muscle')
              : tr(locale, 'Название или мышца', 'Name or muscle')
          }
          type="search"
          value={query}
        />
        <div className="picker-list">
          {!showAddOptions && (
            <>
              {optionGroups.map((group) => (
                <section
                  className={
                    replacedExercise?.primaryMuscles[0] === group.muscle
                      ? 'picker-muscle-group preferred'
                      : 'picker-muscle-group'
                  }
                  key={group.muscle}
                >
                  <div className="picker-muscle-heading">
                    <strong>{muscleLabel(group.muscle, locale)}</strong>
                    {replacedExercise?.primaryMuscles[0] === group.muscle ? (
                      <span>{tr(locale, 'Исходная группа', 'Original muscle')}</span>
                    ) : (
                      <span>{group.exercises.length}</span>
                    )}
                  </div>
                  <div className="picker-muscle-options">
                    {group.exercises.map((exercise) => {
                      const choosing = choosingExerciseId === exercise.id;
                      return (
                        <button
                          aria-busy={choosing || undefined}
                          className={choosing ? 'picker-option choosing' : 'picker-option'}
                          disabled={choosingExerciseId !== null}
                          key={exercise.id}
                          onClick={() => chooseOnce(exercise)}
                          onMouseDown={(event) => event.preventDefault()}
                          type="button"
                        >
                          <span className="picker-option-copy">
                            <strong>{exerciseName(exercise, locale)}</strong>
                            <small>{locale === 'en' ? exercise.nameRu : exercise.nameEn}</small>
                            <span className="picker-option-muscle">
                              {muscleLabel(exercise.primaryMuscles[0], locale)}
                            </span>
                          </span>
                          <span className="picker-option-tags">
                            <ExercisePreferenceBadge value={preferences.get(exercise.id) ?? null} />
                            <Tag tag={exercise.tag} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {explicitDislikedOptions.length > 0 && (
                <section className="picker-muscle-group disliked-results">
                  <div className="picker-muscle-heading">
                    <strong>{tr(locale, 'Вы сами нашли', 'You searched for these')}</strong>
                    <span>{tr(locale, 'Отмечено: не нравится', 'Marked: dislike')}</span>
                  </div>
                  <div className="picker-muscle-options">
                    {explicitDislikedOptions.map((exercise) => {
                      const choosing = choosingExerciseId === exercise.id;
                      return (
                        <button
                          aria-busy={choosing || undefined}
                          className={choosing ? 'picker-option choosing' : 'picker-option'}
                          disabled={choosingExerciseId !== null}
                          key={exercise.id}
                          onClick={() => chooseOnce(exercise)}
                          onMouseDown={(event) => event.preventDefault()}
                          type="button"
                        >
                          <span className="picker-option-copy">
                            <strong>{exerciseName(exercise, locale)}</strong>
                            <small>{locale === 'en' ? exercise.nameRu : exercise.nameEn}</small>
                            <span className="picker-option-muscle">
                              {muscleLabel(exercise.primaryMuscles[0], locale)}
                            </span>
                          </span>
                          <span className="picker-option-tags">
                            <ExercisePreferenceBadge value="dislike" />
                            <Tag tag={exercise.tag} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
              {!options.length &&
                !explicitDislikedOptions.length &&
                (normalizedQuery.length < 2 ? (
                  <div className="picker-empty">
                    <strong>
                      {mode.mode === 'replace' && hiddenDislikedCount > 0
                        ? tr(
                            locale,
                            'Отмеченные «Не нравится» варианты скрыты',
                            'Disliked choices are hidden',
                          )
                        : tr(locale, 'Начни вводить название', 'Start typing a name')}
                    </strong>
                    <span>
                      {mode.mode === 'replace' && hiddenDislikedCount > 0
                        ? tr(
                            locale,
                            'Введи конкретное название, чтобы при необходимости выбрать такое упражнение один раз.',
                            'Enter a specific name if you want to choose one of them once.',
                          )
                        : tr(
                            locale,
                            'Каталог ищется сразу. Если упражнения нет, его можно создать вручную или найти в интернете.',
                            'The catalog searches instantly. If the exercise is missing, create it manually or find it online.',
                          )}
                    </span>
                  </div>
                ) : matchingCatalog.length > 0 ? (
                  <div className="picker-empty">
                    <strong>
                      {tr(locale, 'Упражнение уже в плане', 'Exercise already in the plan')}
                    </strong>
                    <span>
                      {tr(
                        locale,
                        'Найденное упражнение уже добавлено в текущую тренировку.',
                        'The matching exercise is already in the current workout.',
                      )}
                    </span>
                  </div>
                ) : (
                  <ExerciseAddPanel
                    existingExercises={catalog}
                    locale={locale}
                    onExerciseSaved={async (exercise) => {
                      await cacheExercise(exercise);
                      await onChoose(exercise);
                    }}
                    query={query}
                  />
                ))}
              {(options.length > 0 || explicitDislikedOptions.length > 0) &&
                normalizedQuery.length >= 2 && (
                  <KeyboardSafeButton
                    className="picker-discovery-link"
                    onPress={() => setShowAddOptions(true)}
                    type="button"
                  >
                    {tr(
                      locale,
                      'Не то упражнение? Создать новое или найти в интернете',
                      'Not the right exercise? Create a new one or search online',
                    )}
                  </KeyboardSafeButton>
                )}
            </>
          )}
          {showAddOptions && (
            <ExerciseAddPanel
              existingExercises={catalog}
              hasMatches
              locale={locale}
              onExerciseSaved={async (exercise) => {
                await cacheExercise(exercise);
                await onChoose(exercise);
              }}
              query={query}
            />
          )}
        </div>
        <button className="button ghost full" onClick={onClose} type="button">
          {tr(locale, 'Отмена', 'Cancel')}
        </button>
      </section>
    </div>
  );
}

function ExercisePreferenceControls({
  className = '',
  compact = false,
  onToggle,
  value,
}: {
  className?: string;
  compact?: boolean;
  onToggle: (value: ExercisePreferenceValue) => Promise<void>;
  value: ExercisePreferenceValue | null;
}) {
  const { locale } = usePreferences();
  const [saving, setSaving] = useState(false);

  async function toggle(next: ExercisePreferenceValue) {
    if (saving) return;
    setSaving(true);
    try {
      await onToggle(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      aria-label={tr(locale, 'Личное отношение к упражнению', 'Personal exercise preference')}
      className={`exercise-preference-controls ${compact ? 'compact' : ''} ${className}`.trim()}
      role="group"
    >
      <button
        aria-label={tr(locale, 'Нравится', 'Like')}
        aria-pressed={value === 'like'}
        className={value === 'like' ? 'active like' : 'like'}
        disabled={saving}
        onClick={() => void toggle('like')}
        title={tr(locale, 'Нравится', 'Like')}
        type="button"
      >
        <span aria-hidden="true">👍</span>
        {!compact && <span>{tr(locale, 'Нравится', 'Like')}</span>}
      </button>
      <button
        aria-label={tr(locale, 'Не нравится — не предлагать', 'Dislike — do not suggest')}
        aria-pressed={value === 'dislike'}
        className={value === 'dislike' ? 'active dislike' : 'dislike'}
        disabled={saving}
        onClick={() => void toggle('dislike')}
        title={tr(locale, 'Не нравится — не предлагать', 'Dislike — do not suggest')}
        type="button"
      >
        <span aria-hidden="true">👎</span>
        {!compact && <span>{tr(locale, 'Не нравится', 'Dislike')}</span>}
      </button>
    </div>
  );
}

function ExercisePreferenceBadge({ value }: { value: ExercisePreferenceValue | null }) {
  const { locale } = usePreferences();
  if (!value) return null;
  return (
    <span className={`exercise-preference-badge ${value}`}>
      {value === 'like'
        ? tr(locale, '👍 Нравится', '👍 Liked')
        : tr(locale, '👎 Не нравится', '👎 Disliked')}
    </span>
  );
}

function preferenceFilterLabel(
  value: ExercisePreferenceValue | 'unmarked' | 'all',
  locale: CurrentUser['locale'],
) {
  if (value === 'like') return tr(locale, '👍 Нравятся', '👍 Liked');
  if (value === 'dislike') return tr(locale, '👎 Не нравятся', '👎 Disliked');
  if (value === 'unmarked') return tr(locale, 'Без отметки', 'Unmarked');
  return tr(locale, 'Все', 'All');
}

function ExplainSheet({
  activeWorkout,
  catalog,
  scopedExercise,
  sets,
  onClose,
  onApplyCommand,
  onSave,
  onStartWorkout,
  preferences,
}: {
  activeWorkout: LocalWorkout | undefined;
  catalog: Exercise[];
  scopedExercise: Exercise | null;
  sets: LocalSet[];
  onClose: () => void;
  onApplyCommand: (command: NaturalWorkoutCommand) => Promise<void>;
  onStartWorkout: () => Promise<void>;
  preferences: ReadonlyMap<string, ExercisePreferenceValue | null>;
  onSave: (
    exercise: Exercise,
    input: NaturalSetDraft,
    entrySource: Extract<SetEntrySource, 'natural_text' | 'voice_ai'>,
  ) => Promise<void>;
}) {
  const { locale, unitSystem } = usePreferences();
  const [mode, setMode] = useState<'text' | 'voice'>(() => loadInputMode());
  const [text, setText] = useState('');
  const [result, setResult] = useState<NaturalInputResult | null>(null);
  const [commandOverrides, setCommandOverrides] = useState<WorkoutCommandOverrides>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [entrySource, setEntrySource] =
    useState<Extract<SetEntrySource, 'natural_text' | 'voice_ai'>>('natural_text');
  const autoStartVoice = useRef(mode === 'voice').current;

  function chooseMode(next: 'text' | 'voice') {
    setMode(next);
    saveInputMode(next);
    setResult(null);
    setCommandOverrides({});
    setSaveError(null);
  }

  function parseInput(
    input: string,
    exerciseOverride: Exercise | null = null,
    overrides: WorkoutCommandOverrides = {},
    inputCatalog: Exercise[] = catalog,
  ): NaturalInputResult {
    const command = parseNaturalWorkoutCommand({
      text: input,
      catalog: inputCatalog,
      plan: activeWorkout?.exercises ?? [],
      locale,
      overrides,
    });
    if (command.status !== 'not_command') return command;
    const exerciseContext = buildNaturalSetExerciseContext({
      plan: activeWorkout?.exercises ?? [],
      sets: sets.filter((set) => set.workoutId === activeWorkout?.id),
      catalog,
    });
    return parseNaturalSet({
      text: input,
      catalog,
      preferredExercises: exerciseContext.preferredExercises,
      scopedExercise: scopedExercise ?? exerciseContext.fallbackExercise,
      exerciseOverride,
      locale,
      unitSystem,
    });
  }

  function interpret(
    exerciseOverride: Exercise | null = null,
    overrides: WorkoutCommandOverrides = commandOverrides,
  ) {
    setResult(parseInput(text, exerciseOverride, overrides));
  }

  async function confirmParsed(exercise: Exercise, draft: NaturalSetDraft) {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(exercise, draft, entrySource);
    } catch {
      setSaveError(
        tr(
          locale,
          'Не удалось записать подход. Фраза сохранена в форме — попробуй ещё раз.',
          'Could not save the set. The phrase is still in the form — try again.',
        ),
      );
      setSaving(false);
    }
  }

  async function confirmCommand(command: NaturalWorkoutCommand) {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onApplyCommand(command);
    } catch {
      setSaveError(
        tr(
          locale,
          'Не удалось изменить план. Фраза сохранена в форме — попробуй ещё раз.',
          'Could not change the plan. The phrase is still in the form — try again.',
        ),
      );
      setSaving(false);
    }
  }

  function editPhrase() {
    setMode('text');
    setResult(null);
    setCommandOverrides({});
    setSaveError(null);
  }

  function acceptVoiceTranscript(transcript: string) {
    setText(transcript);
    setEntrySource('voice_ai');
    setCommandOverrides({});
    const parsed = parseInput(transcript);
    setResult(parsed);
    setSaveError(null);
    if (
      parsed.status === 'needs_clarification' ||
      parsed.status === 'command_needs_clarification'
    ) {
      setMode('text');
    }
  }

  const previousSet =
    result?.status === 'ready'
      ? sets
          .filter((set) => set.exerciseId === result.exercise.id && !set.deleted)
          .sort((left, right) => right.performedAt.localeCompare(left.performedAt))[0]
      : null;

  async function startWorkoutFromCommand() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onStartWorkout();
    } catch {
      setSaveError(
        tr(
          locale,
          'Не удалось начать тренировку. Попробуй ещё раз.',
          'Could not start the workout. Try again.',
        ),
      );
      setSaving(false);
    }
  }

  if (!activeWorkout) {
    return (
      <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
        <section
          aria-modal="true"
          className="sheet explain-sheet workout-required-sheet"
          onMouseDown={(event) => event.stopPropagation()}
          role="dialog"
        >
          <div className="sheet-handle" />
          <p className="eyebrow">{tr(locale, 'Пояснить', 'Describe')}</p>
          <h2>
            {tr(locale, 'Команды работают во время тренировки', 'Commands work during a workout')}
          </h2>
          <p className="explain-context">
            {tr(
              locale,
              'Начни тренировку — тогда голосом или текстом можно будет записывать подходы и менять план.',
              'Start a workout, then use voice or text to log sets and change the plan.',
            )}
          </p>
          {saveError && (
            <p className="clarification compact" role="alert">
              {saveError}
            </p>
          )}
          <button
            className="button primary full"
            disabled={saving}
            onClick={() => void startWorkoutFromCommand()}
            type="button"
          >
            {saving
              ? tr(locale, 'Начинаю…', 'Starting…')
              : tr(locale, 'Начать тренировку', 'Start workout')}
          </button>
          <button className="button ghost full" onClick={onClose} type="button">
            {tr(locale, 'Закрыть', 'Close')}
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="sheet explain-sheet"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <p className="eyebrow">{tr(locale, 'Пояснить', 'Describe')}</p>
        <h2>
          {scopedExercise
            ? exerciseName(scopedExercise, locale)
            : tr(locale, 'Подход или команда', 'Set or command')}
        </h2>
        <p className="explain-context">
          {activeWorkout
            ? scopedExercise
              ? `${tr(locale, 'Контекст', 'Context')}: ${exerciseName(scopedExercise, locale)}`
              : tr(locale, 'Контекст: текущая тренировка', 'Context: current workout')
            : tr(
                locale,
                'Сначала начни тренировку — подход привязывается к активной сессии.',
                'Start a workout first — the set is linked to the active session.',
              )}
        </p>
        <div
          aria-label={tr(locale, 'Способ ввода', 'Input method')}
          className="input-modes"
          role="tablist"
        >
          <button
            aria-selected={mode === 'text'}
            className={mode === 'text' ? 'active' : ''}
            onClick={() => chooseMode('text')}
            role="tab"
            type="button"
          >
            ⌨️ {tr(locale, 'Текст', 'Text')}
          </button>
          <button
            aria-selected={mode === 'voice'}
            className={mode === 'voice' ? 'active' : ''}
            onClick={() => chooseMode('voice')}
            role="tab"
            type="button"
          >
            🎙️ {tr(locale, 'Голос', 'Voice')}
          </button>
        </div>
        <p className="manual-entry-note">
          {tr(
            locale,
            'Ручной «＋ Подход» всегда доступен в тренировке.',
            'Manual “＋ Set” is always available in the workout.',
          )}
        </p>

        {result?.status === 'command_ready' ? (
          <div className="parsed-set" aria-live="polite">
            <strong>
              {tr(locale, 'Понял команду — выполнить?', 'I understood the command — apply it?')}
            </strong>
            <WorkoutCommandPreview
              command={result.command}
              disliked={
                result.command.type === 'replace' &&
                preferences.get(result.command.replacement.id) === 'dislike'
              }
              locale={locale}
            />
            {saveError && (
              <p className="clarification compact" role="alert">
                {saveError}
              </p>
            )}
            <div className="parsed-actions">
              <button className="button ghost" onClick={editPhrase} type="button">
                {tr(locale, 'Исправить фразу', 'Edit phrase')}
              </button>
              <button
                className="button primary"
                disabled={saving}
                onClick={() => void confirmCommand(result.command)}
                type="button"
              >
                {saving ? tr(locale, 'Применяю…', 'Applying…') : tr(locale, 'Выполнить', 'Apply')}
              </button>
            </div>
          </div>
        ) : result?.status === 'ready' ? (
          <div className="parsed-set" aria-live="polite">
            <strong>
              {tr(locale, 'Понял так — верно?', 'Here is what I understood — correct?')}
            </strong>
            <dl>
              <div>
                <dt>{tr(locale, 'Упражнение', 'Exercise')}</dt>
                <dd>{exerciseName(result.exercise, locale)}</dd>
              </div>
              <div>
                <dt>{tr(locale, 'Подход', 'Set')}</dt>
                <dd>
                  {formatWeight(result.draft.weightKg, locale, unitSystem)} × {result.draft.reps}
                </dd>
              </div>
              <div>
                <dt>RIR</dt>
                <dd>{result.draft.rir ?? tr(locale, 'не указан', 'not specified')}</dd>
              </div>
              <div>
                <dt>{tr(locale, 'Комментарий', 'Comment')}</dt>
                <dd>{result.draft.comment ?? '—'}</dd>
              </div>
            </dl>
            {previousSet && (
              <p className="previous-result">
                {tr(locale, 'Прошлый результат', 'Previous result')}:{' '}
                {formatWeight(previousSet.weightKg, locale, unitSystem)} × {previousSet.reps}
                {previousSet.rir === null ? '' : `, RIR ${previousSet.rir}`}
              </p>
            )}
            {saveError && (
              <p className="clarification compact" role="alert">
                {saveError}
              </p>
            )}
            <div className="parsed-actions">
              <button className="button ghost" onClick={editPhrase} type="button">
                {tr(locale, 'Исправить фразу', 'Edit phrase')}
              </button>
              <button
                className="button primary"
                disabled={saving}
                onClick={() => void confirmParsed(result.exercise, result.draft)}
                type="button"
              >
                {saving
                  ? tr(locale, 'Записываю…', 'Saving…')
                  : tr(locale, 'Подтвердить', 'Confirm')}
              </button>
            </div>
          </div>
        ) : mode === 'voice' ? (
          <VoicePanel
            activeWorkoutId={activeWorkout?.id ?? null}
            autoStart={autoStartVoice}
            onTranscript={acceptVoiceTranscript}
          />
        ) : (
          <div className="natural-input">
            <label htmlFor="natural-set-input">
              {tr(
                locale,
                'Опиши подход или изменение тренировки',
                'Describe a set or change the workout',
              )}
            </label>
            <textarea
              autoFocus
              id="natural-set-input"
              maxLength={1_500}
              onChange={(event) => {
                setText(event.target.value);
                if (!event.target.value.trim()) setEntrySource('natural_text');
                setResult(null);
                setCommandOverrides({});
              }}
              placeholder={
                scopedExercise
                  ? tr(
                      locale,
                      'Например: сорок на двенадцать, остался один, техника чистая',
                      'For example: 90 for 12, RIR 1, clean technique',
                    )
                  : tr(
                      locale,
                      'Например: «румынка 80 на 8» или «замени верхний блок на румынскую тягу»',
                      'For example: “Romanian deadlift 175 for 8” or “replace lat pulldown with Romanian deadlift”',
                    )
              }
              rows={4}
              value={text}
            />
            {(result?.status === 'needs_clarification' ||
              result?.status === 'command_needs_clarification') && (
              <div className="clarification" role="alert">
                <strong>{tr(locale, 'Нужно уточнение', 'One detail is missing')}</strong>
                <p>{result.question}</p>
                {result.status === 'command_needs_clarification' &&
                  result.role === 'target' &&
                  result.unresolvedPhrase && (
                    <ExerciseDiscoveryPanel
                      initialQuery={result.unresolvedPhrase}
                      locale={locale}
                      onExerciseSaved={async (exercise) => {
                        await cacheExercise(exercise);
                        const nextOverrides = { ...commandOverrides, target: exercise };
                        setCommandOverrides(nextOverrides);
                        setResult(
                          parseInput(text, null, nextOverrides, [
                            ...catalog.filter((item) => item.id !== exercise.id),
                            exercise,
                          ]),
                        );
                      }}
                    />
                  )}
                {result.candidates.length > 0 && (
                  <div className="candidate-list">
                    {result.candidates.map((exercise) => (
                      <button
                        onClick={() => {
                          if (result.status === 'command_needs_clarification') {
                            const nextOverrides = {
                              ...commandOverrides,
                              [result.role]: exercise,
                            };
                            setCommandOverrides(nextOverrides);
                            interpret(null, nextOverrides);
                          } else {
                            interpret(exercise);
                          }
                        }}
                        key={exercise.id}
                        type="button"
                      >
                        {exerciseName(exercise, locale)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              className="button primary full"
              disabled={!activeWorkout || !text.trim()}
              onClick={() => interpret()}
              type="button"
            >
              {tr(locale, 'Разобрать фразу', 'Parse phrase')}
            </button>
          </div>
        )}
        <button className="button ghost full" onClick={onClose} type="button">
          {tr(locale, 'Закрыть', 'Close')}
        </button>
      </section>
    </div>
  );
}

function WorkoutCommandPreview({
  command,
  disliked,
  locale,
}: {
  command: NaturalWorkoutCommand;
  disliked: boolean;
  locale: CurrentUser['locale'];
}) {
  if (command.type !== 'replace') {
    return <p className="confirmation-message">{workoutCommandSummary(command, locale)}</p>;
  }
  return (
    <div className="replacement-command-preview">
      <div className="replacement-field replacement-source">
        <span>{tr(locale, 'Что заменить', 'What to replace')}</span>
        <strong>{exerciseName(command.source.exercise, locale)}</strong>
      </div>
      <span aria-hidden="true" className="replacement-arrow">
        ↓
      </span>
      <div className="replacement-field replacement-target">
        <span>{tr(locale, 'На что заменить', 'Replace with')}</span>
        <strong>{exerciseName(command.replacement, locale)}</strong>
      </div>
      <p>
        {exerciseName(command.source.exercise, locale)} →{' '}
        {exerciseName(command.replacement, locale)}
      </p>
      {disliked && (
        <p className="exercise-preference-warning">
          {tr(
            locale,
            'Вы отметили это упражнение «Не нравится». Команда всё равно может выбрать его один раз.',
            'You marked this exercise as disliked. This command can still choose it once.',
          )}
        </p>
      )}
    </div>
  );
}

function loadInputMode(): 'text' | 'voice' {
  try {
    return localStorage.getItem('mighty-cringe:last-input-mode') === 'voice' ? 'voice' : 'text';
  } catch {
    return 'text';
  }
}

function saveInputMode(mode: 'text' | 'voice') {
  try {
    localStorage.setItem('mighty-cringe:last-input-mode', mode);
  } catch {
    // Remembering the presentation mode is optional.
  }
}

function Tab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`tab ${active ? 'active' : ''}`} onClick={onClick} type="button">
      <span className="tab-icon">{icon}</span>
      <span className="tab-label">{label}</span>
    </button>
  );
}

function NavIcon({ name }: { name: 'workout' | 'progress' | 'explain' | 'catalog' | 'settings' }) {
  const paths = {
    workout: (
      <>
        <path d="M5 8v8M8 6v12M16 6v12M19 8v8M8 12h8" />
      </>
    ),
    progress: (
      <>
        <path d="M4 19V5M4 19h16" />
        <path d="m7 15 4-4 3 2 5-6" />
      </>
    ),
    explain: (
      <>
        <path d="M12 15.5a3.5 3.5 0 0 0 3.5-3.5V7a3.5 3.5 0 1 0-7 0v5a3.5 3.5 0 0 0 3.5 3.5Z" />
        <path d="M5.5 11.5v.5a6.5 6.5 0 0 0 13 0v-.5M12 18.5V21M9 21h6" />
      </>
    ),
    catalog: (
      <>
        <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H11v16H7.5A2.5 2.5 0 0 0 5 21.5v-16Z" />
        <path d="M19 5.5A2.5 2.5 0 0 0 16.5 3H13v16h3.5a2.5 2.5 0 0 1 2.5 2.5v-16Z" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path
          d="M19 13.5v-3l-2-.7a7 7 0 0 0-.7-1.6l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.6-.7L10.5 2h-3l-.7 2a7 7 0 0 0-1.6.7l-1.9-.9-2.1 2.1.9 1.9a7 7 0 0 0-.7 1.6L0 10.5v3l2 .7a7 7 0 0 0 .7 1.6l-.9 1.9 2.1 2.1 1.9-.9a7 7 0 0 0 1.6.7l.7 2.4h3l.7-2a7 7 0 0 0 1.6-.7l1.9.9 2.1-2.1-.9-1.9a7 7 0 0 0 .7-1.6l1.8-.6Z"
          transform="translate(2)"
        />
      </>
    ),
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}

function SyncStatusIcon({
  phase,
  pending,
  conflicts,
}: {
  phase: ReturnType<typeof getSyncStatus>['phase'];
  pending: number;
  conflicts: number;
}) {
  const state = conflicts ? 'conflict' : phase === 'idle' && pending > 0 ? 'pending' : phase;
  return (
    <span aria-hidden="true" className={`sync-status-icon ${state}`}>
      <svg viewBox="0 0 24 24">
        {state === 'idle' ? (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="m8 12 2.5 2.5L16.5 8" />
          </>
        ) : state === 'syncing' ? (
          <>
            <path d="M20 7v5h-5M4 17v-5h5" />
            <path d="M6.1 8.3A7 7 0 0 1 18.8 7M17.9 15.7A7 7 0 0 1 5.2 17" />
          </>
        ) : state === 'offline' ? (
          <>
            <path d="M5 9.5A11 11 0 0 1 19 9.5M8 13a6.5 6.5 0 0 1 8 0M11 16.5a2 2 0 0 1 2 0" />
            <path d="m4 4 16 16" />
          </>
        ) : state === 'pending' ? (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </>
        ) : (
          <>
            <path d="M12 3 2.8 20h18.4L12 3Z" />
            <path d="M12 9v5M12 17.5h.01" />
          </>
        )}
      </svg>
      {(pending > 0 || conflicts > 0) && <i>{conflicts || pending}</i>}
    </span>
  );
}

function CatalogFilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={active ? 'active' : ''}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function Tag({ tag }: { tag: Exercise['tag'] }) {
  const labels = { mighty: '⚡ Mighty', normal: '• Normal', cringe: '😬 Cringe' };
  return <span className={`tag ${tag}`}>{labels[tag]}</span>;
}

function muscleLabel(
  muscle: Exercise['primaryMuscles'][number] | undefined,
  locale: CurrentUser['locale'],
) {
  const labels: Record<string, [string, string]> = {
    back: ['Спина', 'Back'],
    middle_delt: ['Средняя дельта', 'Middle delts'],
    chest: ['Грудь', 'Chest'],
    biceps: ['Бицепс', 'Biceps'],
    quadriceps: ['Квадрицепс', 'Quadriceps'],
    triceps: ['Трицепс', 'Triceps'],
    front_delt: ['Передняя дельта', 'Front delts'],
    rear_delt: ['Задняя дельта', 'Rear delts'],
    hamstrings: ['Бицепс бедра', 'Hamstrings'],
    glutes: ['Ягодицы', 'Glutes'],
    adductors: ['Приводящие мышцы', 'Adductors'],
    calves: ['Икры', 'Calves'],
    core: ['Кор', 'Core'],
  };
  const label = labels[muscle ?? ''];
  return label ? label[locale === 'en' ? 1 : 0] : tr(locale, 'Упражнение', 'Exercise');
}

function workoutGroupLabel(size: number, locale: CurrentUser['locale']) {
  if (locale === 'en') return size === 2 ? 'Superset' : `Group of ${size}`;
  if (size === 2) return 'Суперсет';
  if (size === 3) return 'Трисет';
  if (size === 4) return 'Квадрисет';
  return `Связка из ${size}`;
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

function formatWorkoutConfirmationDate(startedAt: string, locale: CurrentUser['locale']) {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(startedAt));
}

function youtubeVideoId(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') return parsed.pathname.slice(1).split('/')[0] || null;
    if (
      parsed.hostname === 'youtube.com' ||
      parsed.hostname.endsWith('.youtube.com') ||
      parsed.hostname === 'youtube-nocookie.com' ||
      parsed.hostname.endsWith('.youtube-nocookie.com')
    ) {
      if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
      const match = /^\/(?:embed|shorts)\/([^/?]+)/u.exec(parsed.pathname);
      return match?.[1] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

function firstName(displayName: string, locale: CurrentUser['locale']) {
  return displayName.trim().split(/\s+/)[0] || tr(locale, 'спортсмен', 'athlete');
}

function canUseTrainerConsole(role: CurrentUser['role']) {
  return role === 'trainer' || role === 'admin' || role === 'superadmin';
}

function parseDraftWorkoutPlan(value: string | null) {
  if (value === null) return null;
  try {
    const parsed = workoutPlanSchema.safeParse(JSON.parse(value));
    return parsed.success ? normalizeWorkoutPlan(parsed.data) : null;
  } catch {
    return null;
  }
}

function mutationWorkoutId(mutation: Parameters<typeof queueMutation>[0]) {
  switch (mutation.type) {
    case 'workout.create':
      return mutation.payload.id;
    case 'workout.update':
    case 'workout.touch':
    case 'workout.delete':
    case 'set.create':
    case 'set.update':
    case 'set.delete':
      return mutation.payload.workoutId;
    case 'measurement.create':
    case 'measurement.update':
    case 'measurement.delete':
      return null;
  }
}

function syncStatusLabel(
  phase: ReturnType<typeof getSyncStatus>['phase'],
  pending: number,
  conflicts: number,
  locale: CurrentUser['locale'],
) {
  if (conflicts) return tr(locale, `Конфликтов: ${conflicts}`, `Conflicts: ${conflicts}`);
  if (phase === 'offline')
    return tr(locale, `Офлайн · ждёт ${pending}`, `Offline · ${pending} pending`);
  if (phase === 'error') {
    return pending
      ? tr(locale, `Не отправлено: ${pending}`, `Not sent: ${pending}`)
      : tr(locale, 'Сервер недоступен', 'Server unavailable');
  }
  if (phase === 'syncing') {
    return pending
      ? tr(locale, `Отправляю: ${pending}`, `Sending: ${pending}`)
      : tr(locale, 'Проверяю сервер…', 'Checking server…');
  }
  return pending
    ? tr(locale, `Ожидает отправки: ${pending}`, `Pending: ${pending}`)
    : tr(locale, 'Синхронизировано', 'Synced');
}

function syncStatusExplanation(
  phase: ReturnType<typeof getSyncStatus>['phase'],
  pending: number,
  conflicts: number,
  locale: CurrentUser['locale'],
) {
  if (conflicts) {
    return tr(
      locale,
      'Есть изменения, которые нужно сравнить вручную. Локальная копия сохранена.',
      'Some changes need a manual comparison. Your local copy is safe.',
    );
  }
  if (phase === 'offline') {
    return tr(
      locale,
      `Сети нет. Всё сохранено на устройстве${pending ? `; ждут отправки: ${pending}` : ''}.`,
      `You are offline. Everything is saved on this device${pending ? `; ${pending} waiting to send` : ''}.`,
    );
  }
  if (phase === 'error') {
    return tr(
      locale,
      'Данные на устройстве сохранены, но сервер пока недоступен. Можно повторить синхронизацию.',
      'Your data is safe on this device, but the server is unavailable. You can retry the sync.',
    );
  }
  if (phase === 'syncing') {
    return tr(
      locale,
      'Проверяем сервер и отправляем сохранённые изменения.',
      'Checking the server and sending saved changes.',
    );
  }
  if (pending) {
    return tr(
      locale,
      'Изменения сохранены на устройстве и скоро будут отправлены.',
      'Changes are saved on this device and will be sent shortly.',
    );
  }
  return tr(
    locale,
    'Сохранено на устройстве · синхронизировано с сервером.',
    'Saved on this device · synced with the server.',
  );
}

function lastSyncTitle(value: string | null, locale: CurrentUser['locale']) {
  if (!value) {
    return tr(
      locale,
      'Успешной синхронизации на этом устройстве ещё не было',
      'This device has not completed a sync yet',
    );
  }
  const date = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
  return tr(locale, `Последняя успешная синхронизация: ${date}`, `Last successful sync: ${date}`);
}

function publicLocale(): CurrentUser['locale'] {
  try {
    return navigator.language.toLocaleLowerCase().startsWith('en') ? 'en' : 'ru';
  } catch {
    return 'ru';
  }
}
