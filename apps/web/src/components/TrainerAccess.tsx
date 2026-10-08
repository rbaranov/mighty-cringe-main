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
import { ScreenNavigation } from './ScreenNavigation';
import './AthleteContextHeader.css';

export function TrainerRelationshipCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const { locale } = usePreferences();
  const [trainer, setTrainer] = useState<TrainerSummary | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

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
    setSaving(true);
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
    } finally {
      setSaving(false);
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
      {trainer && (
        <TrainerConnectionControls
          trainerName={trainer.displayName}
          confirming={confirming}
          saving={saving}
          onRequestDisconnect={() => setConfirming(true)}
          onDisconnect={() => void revoke()}
          onCancel={() => setConfirming(false)}
        />
      )}
      {error && <p className="auth-error">{error}</p>}
    </section>
  );
}

export function TrainerConnectionControls({
  trainerName,
  confirming,
  saving,
  onRequestDisconnect,
  onDisconnect,
  onCancel,
}: {
  trainerName: string;
  confirming: boolean;
  saving: boolean;
  onRequestDisconnect: () => void;
  onDisconnect: () => void;
  onCancel: () => void;
}) {
  const { locale } = usePreferences();
  return (
    <div className="trainer-permission-actions">
      <p>
        {tr(
          locale,
          'Тренер видит весь твой спортивный журнал и может добавлять, изменять и удалять тренировки, подходы, замеры, избранное и упражнения в личном каталоге. Аккаунт, аудиозаписи и управление доступом остаются только у тебя.',
          'Your coach can view your entire training log and add, edit or delete workouts, sets, measurements, favorites and personal exercises. Your account, audio recordings and access settings remain under your control.',
        )}
      </p>
      {confirming ? (
        <div className="inline-confirmation">
          <p>
            {tr(
              locale,
              `Отключить тренера ${trainerName}? Он сразу потеряет возможность смотреть и изменять твой спортивный журнал. Уже внесённые изменения сохранятся.`,
              `Disconnect coach ${trainerName}? They will immediately lose access to view and edit your training log. Changes already made will remain.`,
            )}
          </p>
          <button
            className="button danger small"
            disabled={saving}
            onClick={onDisconnect}
            type="button"
          >
            {saving
              ? tr(locale, 'Отключаем…', 'Disconnecting…')
              : tr(locale, 'Да, отключить', 'Disconnect')}
          </button>
          <button className="button ghost small" disabled={saving} onClick={onCancel} type="button">
            {tr(locale, 'Отмена', 'Cancel')}
          </button>
        </div>
      ) : (
        <button className="button ghost small" onClick={onRequestDisconnect} type="button">
          {tr(locale, 'Отключить тренера', 'Disconnect coach')}
        </button>
      )}
    </div>
  );
}

export function TrainerDashboard({
  onBack,
  onOpenAthlete,
}: {
  onBack: () => void;
  onOpenAthlete?: (athlete: TrainerAthleteSummary) => void;
}) {
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
      <section className="screen screen-nested trainer-dashboard">
        <ScreenNavigation
          backLabel={tr(locale, 'К списку учеников', 'Back to trainees')}
          onBack={() => setSelected(null)}
          title={tr(locale, 'Ученик', 'Athlete')}
        />
        <div className="trainer-heading">
          <div>
            <h1>{selected.displayName}</h1>
          </div>
        </div>
        {onOpenAthlete && (
          <button
            className="button primary full"
            onClick={() => onOpenAthlete(selected)}
            type="button"
          >
            {tr(locale, 'Открыть журнал подопечного', 'Open athlete journal')}
          </button>
        )}
        {error && <p className="auth-error">{error}</p>}
        {!details ? (
          <p className="sets-line muted">{tr(locale, 'Загружаем историю…', 'Loading history…')}</p>
        ) : (
          <AthleteJournalOverview {...details} />
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
    <section className="screen screen-nested trainer-dashboard">
      <ScreenNavigation
        backLabel={tr(locale, 'К настройкам', 'Back to settings')}
        onBack={onBack}
        title={tr(locale, 'Кабинет тренера', 'Trainer dashboard')}
      />
      <div className="trainer-heading">
        <div>
          <h1>{tr(locale, 'Подопечные', 'Athletes')}</h1>
        </div>
      </div>
      <p className="intro">
        {tr(
          locale,
          'После принятия приглашения ты сможешь вести спортивный журнал подопечного: тренировки, подходы, замеры, избранное и личный каталог упражнений. Подопечный может отключить тебя в настройках.',
          'Once the invitation is accepted, you can manage the athlete’s training log: workouts, sets, measurements, favorites and personal exercises. The athlete can disconnect you in Settings.',
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

function AthleteJournalOverview({
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
        <h2>{tr(locale, 'Все тренировки', 'All workouts')}</h2>
        {workouts.length ? (
          workouts.map((workout) => (
            <article key={workout.id}>
              <strong>{formatDate(workout.startedAt, locale)}</strong>
              <span>
                {workout.exercises.length} {tr(locale, 'упр.', 'exercises')} · {workout.sets.length}{' '}
                {setCountLabel(workout.sets.length, locale)}
              </span>
              <small>
                {workout.sets
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
        <h2>{tr(locale, 'Все замеры', 'All measurements')}</h2>
        {measurements.length ? (
          measurements.map((measurement) => (
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
    bodyFatPercent: ['% жира', 'body fat'],
  };
  return Object.entries(measurement.values)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .slice(0, 4)
    .map(([key, value]) => {
      const label = labels[key]?.[locale === 'en' ? 1 : 0] ?? key;
      return `${label}: ${displayMeasurement(key as Exclude<keyof MeasurementRecord['values'], 'rfmSex'>, value, locale, unitSystem)}`;
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
