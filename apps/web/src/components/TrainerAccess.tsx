import { useCallback, useEffect, useState } from 'react';

import type {
  MeasurementRecord,
  TrainerAthleteSummary,
  TrainerInviteRecord,
  TrainerSummary,
  WorkoutRecord,
} from '@mighty-cringe/contracts';

import {
  createTrainerInvite,
  getTrainerRelationship,
  listTrainerAthletes,
  listTrainerInvites,
  loadTrainerAthlete,
  revokeTrainerAthlete,
  revokeTrainerInvite,
  revokeTrainerRelationship,
} from '../lib/trainer';

export function TrainerRelationshipCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [trainer, setTrainer] = useState<TrainerSummary | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let active = true;
    void getTrainerRelationship()
      .then((payload) => {
        if (active) setTrainer(payload.trainer);
      })
      .catch(() => {
        if (active) setError('Связь с тренером сейчас недоступна.');
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  async function revoke() {
    setError(null);
    try {
      await revokeTrainerRelationship();
      setTrainer(null);
      setConfirming(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Не удалось отозвать доступ.',
      );
    }
  }

  return (
    <section className="trainer-relationship" aria-live="polite">
      <div className="setting">
        <span>Мой тренер</span>
        <strong>
          {trainer === undefined ? 'Проверяем…' : (trainer?.displayName ?? 'Не подключён')}
        </strong>
      </div>
      {trainer && !confirming && (
        <button className="button ghost small" onClick={() => setConfirming(true)} type="button">
          Отозвать доступ тренера
        </button>
      )}
      {trainer && confirming && (
        <div className="inline-confirmation">
          <p>Тренер сразу перестанет видеть тренировки и замеры. Продолжить?</p>
          <button className="button danger small" onClick={() => void revoke()} type="button">
            Да, отозвать
          </button>
          <button className="button ghost small" onClick={() => setConfirming(false)} type="button">
            Отмена
          </button>
        </div>
      )}
      {error && <p className="auth-error">{error}</p>}
    </section>
  );
}

export function TrainerDashboard({ onBack }: { onBack: () => void }) {
  const [athletes, setAthletes] = useState<TrainerAthleteSummary[]>([]);
  const [invites, setInvites] = useState<TrainerInviteRecord[]>([]);
  const [email, setEmail] = useState('');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TrainerAthleteSummary | null>(null);
  const [details, setDetails] = useState<{
    workouts: WorkoutRecord[];
    measurements: MeasurementRecord[];
  } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [athletePayload, invitePayload] = await Promise.all([
        listTrainerAthletes(),
        listTrainerInvites(),
      ]);
      setAthletes(athletePayload.items);
      setInvites(invitePayload.items);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Не удалось открыть кабинет.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function createInvite() {
    setError(null);
    try {
      const payload = await createTrainerInvite(email);
      const url = new URL('/', window.location.origin);
      url.searchParams.set('trainerInvite', payload.token);
      setShareUrl(url.toString());
      setEmail('');
      await reload();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Не удалось создать приглашение.',
      );
    }
  }

  async function copyInvite() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      setError('Скопируй ссылку из поля вручную.');
    }
  }

  async function openAthlete(athlete: TrainerAthleteSummary) {
    setSelected(athlete);
    setDetails(null);
    setError(null);
    try {
      setDetails(await loadTrainerAthlete(athlete.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Данные недоступны.');
    }
  }

  async function removeAthlete(athleteId: string) {
    setError(null);
    try {
      await revokeTrainerAthlete(athleteId);
      setConfirmRevoke(null);
      setSelected(null);
      setDetails(null);
      await reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось убрать ученика.');
    }
  }

  async function cancelInvite(inviteId: string) {
    setError(null);
    try {
      await revokeTrainerInvite(inviteId);
      await reload();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Не удалось отозвать приглашение.',
      );
    }
  }

  if (selected) {
    return (
      <section className="screen trainer-dashboard">
        <button className="button ghost small" onClick={() => setSelected(null)} type="button">
          ‹ Подопечные
        </button>
        <div className="trainer-heading">
          <div>
            <p className="eyebrow">Ученик</p>
            <h1>{selected.displayName}</h1>
          </div>
          <span className="read-only-badge">👁 Только чтение</span>
        </div>
        {error && <p className="auth-error">{error}</p>}
        {!details ? (
          <p className="sets-line muted">Загружаем историю…</p>
        ) : (
          <AthleteReadOnlyDetails {...details} />
        )}
        {confirmRevoke === selected.id ? (
          <div className="inline-confirmation">
            <p>Убрать ученика? После этого его данные сразу станут недоступны.</p>
            <button
              className="button danger small"
              onClick={() => void removeAthlete(selected.id)}
              type="button"
            >
              Да, убрать
            </button>
            <button
              className="button ghost small"
              onClick={() => setConfirmRevoke(null)}
              type="button"
            >
              Отмена
            </button>
          </div>
        ) : (
          <button
            className="button ghost full"
            onClick={() => setConfirmRevoke(selected.id)}
            type="button"
          >
            Убрать ученика из кабинета
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="screen trainer-dashboard">
      <button className="button ghost small" onClick={onBack} type="button">
        ‹ Моя тренировка
      </button>
      <div className="trainer-heading">
        <div>
          <p className="eyebrow">Тренерский кабинет</p>
          <h1>Подопечные</h1>
        </div>
        <span className="read-only-badge">👁 Только чтение</span>
      </div>
      <p className="intro">Ты видишь тренировки и замеры только после принятого приглашения.</p>
      <section className="trainer-invite-card">
        <h2>Пригласить ученика</h2>
        <label htmlFor="trainer-invite-email">Google email — необязательно</label>
        <input
          id="trainer-invite-email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="athlete@example.com"
          type="email"
          value={email}
        />
        <button className="button primary full" onClick={() => void createInvite()} type="button">
          Создать ссылку на 7 дней
        </button>
        {shareUrl && (
          <div className="share-link" aria-live="polite">
            <input aria-label="Ссылка-приглашение" readOnly value={shareUrl} />
            <button className="button ghost small" onClick={() => void copyInvite()} type="button">
              Копировать
            </button>
          </div>
        )}
      </section>
      {error && <p className="auth-error">{error}</p>}
      {loading ? (
        <p className="sets-line muted">Загружаем кабинет…</p>
      ) : athletes.length ? (
        <div className="trainer-roster">
          {athletes.map((athlete) => (
            <button onClick={() => void openAthlete(athlete)} key={athlete.id} type="button">
              <span>{athlete.displayName}</span>
              <small>Подключён {formatDate(athlete.linkedAt)}</small>
              <b>›</b>
            </button>
          ))}
        </div>
      ) : (
        <p className="sets-line muted">Пока нет подключённых учеников.</p>
      )}
      {invites.some((invite) => invite.status === 'pending') && (
        <section className="pending-invites">
          <h2>Ожидают принятия</h2>
          {invites
            .filter((invite) => invite.status === 'pending')
            .map((invite) => (
              <div key={invite.id}>
                <span>{invite.email ?? 'Ссылка без привязки к email'}</span>
                <button
                  className="danger-text"
                  onClick={() => void cancelInvite(invite.id)}
                  type="button"
                >
                  Отозвать
                </button>
              </div>
            ))}
        </section>
      )}
    </section>
  );
}

function AthleteReadOnlyDetails({
  workouts,
  measurements,
}: {
  workouts: WorkoutRecord[];
  measurements: MeasurementRecord[];
}) {
  return (
    <div className="athlete-read-only-details">
      <section>
        <h2>Последние тренировки</h2>
        {workouts.length ? (
          workouts.slice(0, 10).map((workout) => (
            <article key={workout.id}>
              <strong>{formatDate(workout.startedAt)}</strong>
              <span>
                {workout.exercises.length} упр. · {workout.sets.length}{' '}
                {setCountLabel(workout.sets.length)}
              </span>
              <small>
                {workout.sets
                  .slice(0, 8)
                  .map((set) => `${set.weightKg}×${set.reps}`)
                  .join(' · ') || 'Без подходов'}
              </small>
            </article>
          ))
        ) : (
          <p className="sets-line muted">Тренировок ещё нет.</p>
        )}
      </section>
      <section>
        <h2>Последние замеры</h2>
        {measurements.length ? (
          measurements.slice(0, 5).map((measurement) => (
            <article key={measurement.id}>
              <strong>{formatDate(measurement.measuredOn)}</strong>
              <span>{formatMeasurements(measurement)}</span>
            </article>
          ))
        ) : (
          <p className="sets-line muted">Замеров ещё нет.</p>
        )}
      </section>
    </div>
  );
}

function formatMeasurements(measurement: MeasurementRecord) {
  const labels: Record<string, string> = {
    heightCm: 'рост',
    weightKg: 'вес',
    waistCm: 'талия',
    chestCm: 'грудь',
    bicepsCm: 'бицепс',
  };
  return Object.entries(measurement.values)
    .filter((entry): entry is [string, number] => entry[1] !== null)
    .slice(0, 4)
    .map(([key, value]) => `${labels[key] ?? key}: ${value}`)
    .join(' · ');
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(new Date(value));
}

function setCountLabel(value: number) {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'подходов';
  if (mod10 === 1) return 'подход';
  if (mod10 >= 2 && mod10 <= 4) return 'подхода';
  return 'подходов';
}
