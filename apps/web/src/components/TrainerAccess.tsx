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
import { displayMeasurement, formatWeight, tr, usePreferences } from '../lib/preferences';

export function TrainerRelationshipCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const { locale } = usePreferences();
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
        if (active) {
          setError(
            tr(locale, 'Связь с тренером сейчас недоступна.', 'Coach connection is unavailable.'),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [locale, refreshKey]);

  async function revoke() {
    setError(null);
    try {
      await revokeTrainerRelationship();
      setTrainer(null);
      setConfirming(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : tr(locale, 'Не удалось отозвать доступ.', 'Could not revoke access.'),
      );
    }
  }

  return (
    <section className="trainer-relationship" aria-live="polite">
      <div className="setting">
        <span>{tr(locale, 'Мой тренер', 'My coach')}</span>
        <strong>
          {trainer === undefined
            ? tr(locale, 'Проверяем…', 'Checking…')
            : (trainer?.displayName ?? tr(locale, 'Не подключён', 'Not connected'))}
        </strong>
      </div>
      {trainer && !confirming && (
        <button className="button ghost small" onClick={() => setConfirming(true)} type="button">
          {tr(locale, 'Отозвать доступ тренера', 'Revoke coach access')}
        </button>
      )}
      {trainer && confirming && (
        <div className="inline-confirmation">
          <p>
            {tr(
              locale,
              'Тренер сразу перестанет видеть тренировки и замеры. Продолжить?',
              'The coach will immediately lose access to workouts and measurements. Continue?',
            )}
          </p>
          <button className="button danger small" onClick={() => void revoke()} type="button">
            {tr(locale, 'Да, отозвать', 'Revoke')}
          </button>
          <button className="button ghost small" onClick={() => setConfirming(false)} type="button">
            {tr(locale, 'Отмена', 'Cancel')}
          </button>
        </div>
      )}
      {error && <p className="auth-error">{error}</p>}
    </section>
  );
}

export function TrainerDashboard({ onBack }: { onBack: () => void }) {
  const { locale } = usePreferences();
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
        requestError instanceof Error
          ? requestError.message
          : tr(locale, 'Не удалось открыть кабинет.', 'Could not open the coach dashboard.'),
      );
    } finally {
      setLoading(false);
    }
  }, [locale]);

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
        requestError instanceof Error
          ? requestError.message
          : tr(locale, 'Не удалось создать приглашение.', 'Could not create an invitation.'),
      );
    }
  }

  async function copyInvite() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      setError(
        tr(locale, 'Скопируй ссылку из поля вручную.', 'Copy the link from the field manually.'),
      );
    }
  }

  async function openAthlete(athlete: TrainerAthleteSummary) {
    setSelected(athlete);
    setDetails(null);
    setError(null);
    try {
      setDetails(await loadTrainerAthlete(athlete.id));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : tr(locale, 'Данные недоступны.', 'Data is unavailable.'),
      );
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
      setError(
        requestError instanceof Error
          ? requestError.message
          : tr(locale, 'Не удалось убрать ученика.', 'Could not remove the athlete.'),
      );
    }
  }

  async function cancelInvite(inviteId: string) {
    setError(null);
    try {
      await revokeTrainerInvite(inviteId);
      await reload();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : tr(locale, 'Не удалось отозвать приглашение.', 'Could not revoke the invitation.'),
      );
    }
  }

  if (selected) {
    return (
      <section className="screen trainer-dashboard">
        <button className="button ghost small" onClick={() => setSelected(null)} type="button">
          ‹ {tr(locale, 'Подопечные', 'Athletes')}
        </button>
        <div className="trainer-heading">
          <div>
            <p className="eyebrow">{tr(locale, 'Ученик', 'Athlete')}</p>
            <h1>{selected.displayName}</h1>
          </div>
          <span className="read-only-badge">👁 {tr(locale, 'Только чтение', 'Read only')}</span>
        </div>
        {error && <p className="auth-error">{error}</p>}
        {!details ? (
          <p className="sets-line muted">{tr(locale, 'Загружаем историю…', 'Loading history…')}</p>
        ) : (
          <AthleteReadOnlyDetails {...details} />
        )}
        {confirmRevoke === selected.id ? (
          <div className="inline-confirmation">
            <p>
              {tr(
                locale,
                'Убрать ученика? После этого его данные сразу станут недоступны.',
                'Remove this athlete? Their data will become unavailable immediately.',
              )}
            </p>
            <button
              className="button danger small"
              onClick={() => void removeAthlete(selected.id)}
              type="button"
            >
              {tr(locale, 'Да, убрать', 'Remove')}
            </button>
            <button
              className="button ghost small"
              onClick={() => setConfirmRevoke(null)}
              type="button"
            >
              {tr(locale, 'Отмена', 'Cancel')}
            </button>
          </div>
        ) : (
          <button
            className="button ghost full"
            onClick={() => setConfirmRevoke(selected.id)}
            type="button"
          >
            {tr(locale, 'Убрать ученика из кабинета', 'Remove athlete from dashboard')}
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="screen trainer-dashboard">
      <button className="button ghost small" onClick={onBack} type="button">
        ‹ {tr(locale, 'Моя тренировка', 'My workout')}
      </button>
      <div className="trainer-heading">
        <div>
          <p className="eyebrow">{tr(locale, 'Тренерский кабинет', 'Coach dashboard')}</p>
          <h1>{tr(locale, 'Подопечные', 'Athletes')}</h1>
        </div>
        <span className="read-only-badge">👁 {tr(locale, 'Только чтение', 'Read only')}</span>
      </div>
      <p className="intro">
        {tr(
          locale,
          'Ты видишь тренировки и замеры только после принятого приглашения.',
          'You can see workouts and measurements only after an invitation is accepted.',
        )}
      </p>
      <section className="trainer-invite-card">
        <h2>{tr(locale, 'Пригласить ученика', 'Invite an athlete')}</h2>
        <label htmlFor="trainer-invite-email">
          {tr(locale, 'Google email — необязательно', 'Google email — optional')}
        </label>
        <input
          id="trainer-invite-email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="athlete@example.com"
          type="email"
          value={email}
        />
        <button className="button primary full" onClick={() => void createInvite()} type="button">
          {tr(locale, 'Создать ссылку на 7 дней', 'Create a 7-day link')}
        </button>
        {shareUrl && (
          <div className="share-link" aria-live="polite">
            <input
              aria-label={tr(locale, 'Ссылка-приглашение', 'Invitation link')}
              readOnly
              value={shareUrl}
            />
            <button className="button ghost small" onClick={() => void copyInvite()} type="button">
              {tr(locale, 'Копировать', 'Copy')}
            </button>
          </div>
        )}
      </section>
      {error && <p className="auth-error">{error}</p>}
      {loading ? (
        <p className="sets-line muted">{tr(locale, 'Загружаем кабинет…', 'Loading dashboard…')}</p>
      ) : athletes.length ? (
        <div className="trainer-roster">
          {athletes.map((athlete) => (
            <button onClick={() => void openAthlete(athlete)} key={athlete.id} type="button">
              <span>{athlete.displayName}</span>
              <small>
                {tr(locale, 'Подключён', 'Connected')} {formatDate(athlete.linkedAt, locale)}
              </small>
              <b>›</b>
            </button>
          ))}
        </div>
      ) : (
        <p className="sets-line muted">
          {tr(locale, 'Пока нет подключённых учеников.', 'No connected athletes yet.')}
        </p>
      )}
      {invites.some((invite) => invite.status === 'pending') && (
        <section className="pending-invites">
          <h2>{tr(locale, 'Ожидают принятия', 'Pending invitations')}</h2>
          {invites
            .filter((invite) => invite.status === 'pending')
            .map((invite) => (
              <div key={invite.id}>
                <span>
                  {invite.email ??
                    tr(locale, 'Ссылка без привязки к email', 'Link not restricted to an email')}
                </span>
                <button
                  className="danger-text"
                  onClick={() => void cancelInvite(invite.id)}
                  type="button"
                >
                  {tr(locale, 'Отозвать', 'Revoke')}
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
  const { locale, unitSystem } = usePreferences();
  return (
    <div className="athlete-read-only-details">
      <section>
        <h2>{tr(locale, 'Последние тренировки', 'Recent workouts')}</h2>
        {workouts.length ? (
          workouts.slice(0, 10).map((workout) => (
            <article key={workout.id}>
              <strong>{formatDate(workout.startedAt, locale)}</strong>
              <span>
                {workout.exercises.length} {tr(locale, 'упр.', 'exercises')} · {workout.sets.length}{' '}
                {setCountLabel(workout.sets.length, locale)}
              </span>
              <small>
                {workout.sets
                  .slice(0, 8)
                  .map((set) => `${formatWeight(set.weightKg, locale, unitSystem)}×${set.reps}`)
                  .join(' · ') || tr(locale, 'Без подходов', 'No sets')}
              </small>
            </article>
          ))
        ) : (
          <p className="sets-line muted">{tr(locale, 'Тренировок ещё нет.', 'No workouts yet.')}</p>
        )}
      </section>
      <section>
        <h2>{tr(locale, 'Последние замеры', 'Recent measurements')}</h2>
        {measurements.length ? (
          measurements.slice(0, 5).map((measurement) => (
            <article key={measurement.id}>
              <strong>{formatDate(measurement.measuredOn, locale)}</strong>
              <span>{formatMeasurements(measurement, locale, unitSystem)}</span>
            </article>
          ))
        ) : (
          <p className="sets-line muted">
            {tr(locale, 'Замеров ещё нет.', 'No measurements yet.')}
          </p>
        )}
      </section>
    </div>
  );
}

function formatMeasurements(
  measurement: MeasurementRecord,
  locale: 'ru' | 'en',
  unitSystem: 'metric' | 'imperial',
) {
  const labels: Record<string, [string, string]> = {
    heightCm: ['рост', 'height'],
    weightKg: ['вес', 'weight'],
    waistCm: ['талия', 'waist'],
    chestCm: ['грудь', 'chest'],
    bicepsCm: ['бицепс', 'biceps'],
  };
  return Object.entries(measurement.values)
    .filter((entry): entry is [string, number] => entry[1] !== null)
    .slice(0, 4)
    .map(([key, value]) => {
      const label = labels[key]?.[locale === 'en' ? 1 : 0] ?? key;
      return `${label}: ${displayMeasurement(key as keyof MeasurementRecord['values'], value, locale, unitSystem)}`;
    })
    .join(' · ');
}

function formatDate(value: string, locale: 'ru' | 'en') {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    dateStyle: 'medium',
  }).format(new Date(value));
}

function setCountLabel(value: number, locale: 'ru' | 'en') {
  if (locale === 'en') return value === 1 ? 'set' : 'sets';
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'подходов';
  if (mod10 === 1) return 'подход';
  if (mod10 >= 2 && mod10 <= 4) return 'подхода';
  return 'подходов';
}
