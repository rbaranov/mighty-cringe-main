import { useEffect, useMemo, useState } from 'react';

import type { Exercise, SetInput } from '@mighty-cringe/contracts';
import { useLiveQuery } from 'dexie-react-hooks';

import { SetSheet } from './components/SetSheet';
import { db } from './lib/db';
import { fallbackCatalog } from './lib/fallbackCatalog';
import { flushOutbox, queueMutation } from './lib/sync';

type View = 'workout' | 'progress' | 'catalog' | 'settings';

const suggestedIds = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006',
];

export default function App() {
  const [view, setView] = useState<View>('workout');
  const [sheetExercise, setSheetExercise] = useState<Exercise | null>(null);
  const [inputOpen, setInputOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  const workouts = useLiveQuery(() => db.workouts.orderBy('startedAt').reverse().toArray(), [], []);
  const sets = useLiveQuery(() => db.sets.toArray(), [], []);
  const exercises = useLiveQuery(() => db.exercises.toArray(), [], []);
  const outboxCount = useLiveQuery(() => db.outbox.count(), [], 0);

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
        const response = await fetch('/api/v1/exercises');
        if (!response.ok) throw new Error('Catalog is unavailable');
        const payload = (await response.json()) as { items: Exercise[] };
        await db.exercises.bulkPut(payload.items);
      } catch {
        const current = await db.exercises.count();
        if (current === 0) await db.exercises.bulkPut(fallbackCatalog);
      }
    };
    void populateCatalog();
  }, []);

  useEffect(() => {
    const sync = () => {
      setOnline(navigator.onLine);
      void flushOutbox();
    };
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    void flushOutbox();
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  async function startWorkout() {
    const id = crypto.randomUUID();
    const clientMutationId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    await db.workouts.put({ id, startedAt, endedAt: null, syncState: 'pending' });
    await queueMutation({
      type: 'workout.create',
      payload: { id, clientMutationId, startedAt, locale: 'ru' },
    });
    await flushOutbox();
  }

  async function saveSet(input: {
    weightKg: number;
    reps: number;
    rir: number | null;
    comment: string | null;
  }) {
    if (!activeWorkout || !sheetExercise) return;
    const set: SetInput = {
      id: crypto.randomUUID(),
      exerciseId: sheetExercise.id,
      ...input,
      performedAt: new Date().toISOString(),
    };
    const clientMutationId = crypto.randomUUID();
    await db.sets.put({ ...set, workoutId: activeWorkout.id, syncState: 'pending' });
    await queueMutation({
      type: 'set.create',
      payload: { clientMutationId, workoutId: activeWorkout.id, set },
    });
    setSheetExercise(null);
    await flushOutbox();
  }

  async function finishWorkout() {
    if (!activeWorkout) return;
    await db.workouts.update(activeWorkout.id, { endedAt: new Date().toISOString() });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="brand">Mighty &amp; Cringe</p>
          <p className="subtle">Привет, R 👋</p>
        </div>
        <span className={online ? 'sync-state online' : 'sync-state'}>
          {online ? (outboxCount ? `Синхронизация: ${outboxCount}` : 'Синхронизировано') : 'Офлайн'}
        </span>
      </header>

      {view === 'workout' && (
        <WorkoutView
          activeWorkout={activeWorkout}
          exercises={suggested}
          onAddSet={setSheetExercise}
          onFinish={finishWorkout}
          onStart={startWorkout}
          sets={sets}
          workouts={workouts}
        />
      )}
      {view === 'catalog' && <CatalogView exercises={exercises} />}
      {view === 'progress' && <ProgressView sets={sets} workouts={workouts} />}
      {view === 'settings' && <SettingsView />}

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

      <SetSheet exercise={sheetExercise} onClose={() => setSheetExercise(null)} onSave={saveSet} />
      {inputOpen && <ExplainSheet onClose={() => setInputOpen(false)} />}
    </main>
  );
}

function WorkoutView({
  activeWorkout,
  exercises,
  sets,
  workouts,
  onStart,
  onAddSet,
  onFinish,
}: {
  activeWorkout: { id: string; startedAt: string } | undefined;
  exercises: Exercise[];
  sets: Array<SetInput & { workoutId: string }>;
  workouts: Array<{ id: string; startedAt: string; endedAt: string | null }>;
  onStart: () => void;
  onAddSet: (exercise: Exercise) => void;
  onFinish: () => void;
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
      <p className="intro">Сегодня: спина + плечи · грудь + бицепс · ноги + трицепс</p>
      <div className="exercise-list">
        {exercises.map((exercise) => {
          const logged = sets.filter(
            (set) => set.workoutId === activeWorkout.id && set.exerciseId === exercise.id,
          );
          return (
            <article className="exercise-card" key={exercise.id}>
              <div className="exercise-card-head">
                <div>
                  <strong>{exercise.nameRu}</strong>
                  <small>{muscleLabel(exercise.primaryMuscles[0])}</small>
                </div>
                <Tag tag={exercise.tag} />
              </div>
              {logged.length ? (
                <p className="sets-line">
                  {logged
                    .map(
                      (set) =>
                        `${set.weightKg}×${set.reps}${set.rir === null ? '' : ` RIR${set.rir}`}`,
                    )
                    .join(' · ')}
                </p>
              ) : (
                <p className="sets-line muted">Ещё нет подходов</p>
              )}
              <button className="add-set" onClick={() => onAddSet(exercise)} type="button">
                ＋ Подход
              </button>
            </article>
          );
        })}
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

function ProgressView({
  workouts,
  sets,
}: {
  workouts: Array<{ id: string; startedAt: string; endedAt: string | null }>;
  sets: Array<SetInput & { workoutId: string }>;
}) {
  const maxEstimatedOneRep = sets.reduce((maximum, set) => {
    const estimated = set.weightKg * (1 + (set.reps + (set.rir ?? 0)) / 30);
    return Math.max(maximum, estimated);
  }, 0);
  return (
    <section className="screen">
      <p className="eyebrow">Твоё движение</p>
      <h1>Прогресс</h1>
      <div className="progress-card">
        <span>Тренировок завершено</span>
        <strong>{workouts.filter((workout) => workout.endedAt).length}</strong>
        <p>Календарь и серия появятся по мере истории.</p>
      </div>
      <div className="progress-card lime">
        <span>Лучший расчётный 1RM</span>
        <strong>{maxEstimatedOneRep ? `${Math.round(maxEstimatedOneRep)} кг` : '—'}</strong>
        <p>Формула Epley с учётом RIR.</p>
      </div>
      <div className="section-head">
        <h2>Замеры</h2>
        <span>скоро</span>
      </div>
      <p className="intro">
        История тела, тренды и импорт прошлых измерений будут сохранены в следующих срезах.
      </p>
    </section>
  );
}

function SettingsView() {
  return (
    <section className="screen">
      <p className="eyebrow">Профиль</p>
      <h1>Настройки</h1>
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
    </section>
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
