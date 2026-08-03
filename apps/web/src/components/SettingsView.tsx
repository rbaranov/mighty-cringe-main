import { useEffect, useState } from 'react';

import type { CurrentUser } from '@mighty-cringe/contracts';
import { useLiveQuery } from 'dexie-react-hooks';

import { db, type SyncConflict } from '../lib/db';
import { getNotificationSettings } from '../lib/notifications';
import { tr, updateProfilePreferences, usePreferences } from '../lib/preferences';
import { getTrainerRelationship } from '../lib/trainer';
import { hasAcceptedVoiceConsent, loadVoiceConfig } from '../lib/voice';
import { DataExportPanel } from './DataExportPanel';
import { PushReminderSettings } from './PushReminderSettings';
import { TrainerRelationshipCard } from './TrainerAccess';
import { VoiceCommandSettingsPanel, VoiceRecordingsPanel } from './VoicePanel';

type Section =
  'preferences' | 'notifications' | 'audio' | 'recordings' | 'coach' | 'data' | 'account';

export function SettingsView({
  user,
  conflicts,
  onLogout,
  onOpenTrainer,
  onResolveConflict,
  onUserUpdated,
  relationshipRefreshKey,
}: {
  user: CurrentUser;
  conflicts: SyncConflict[];
  onLogout: () => void;
  onOpenTrainer?: () => void;
  onResolveConflict: (conflict: SyncConflict, strategy: 'server' | 'mine') => void;
  onUserUpdated: (user: CurrentUser) => Promise<void>;
  relationshipRefreshKey: number;
}) {
  const { locale, unitSystem } = usePreferences();
  const [section, setSection] = useState<Section | null>(null);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null);
  const [audioStatus, setAudioStatus] = useState<'ready' | 'consent' | 'unavailable' | 'loading'>(
    'loading',
  );
  const [coachName, setCoachName] = useState<string | null | undefined>(undefined);
  const recordingCount = useLiveQuery(() => db.voiceEntries.count(), [], 0);

  useEffect(() => {
    if (section !== null) return;
    void getNotificationSettings()
      .then((settings) => setNotificationsEnabled(settings.preferences.enabled))
      .catch(() => setNotificationsEnabled(null));
    void loadVoiceConfig()
      .then(async (config) => {
        if (!config?.enabled) {
          setAudioStatus('unavailable');
          return;
        }
        setAudioStatus(
          (await hasAcceptedVoiceConsent(config.consentVersion)) ? 'ready' : 'consent',
        );
      })
      .catch(() => setAudioStatus('unavailable'));
    void getTrainerRelationship()
      .then((result) => setCoachName(result.trainer?.displayName ?? null))
      .catch(() => setCoachName(null));
  }, [relationshipRefreshKey, section]);

  async function savePreferences(next: {
    locale: CurrentUser['locale'];
    unitSystem: CurrentUser['unitSystem'];
  }) {
    setPreferencesError(null);
    setSavingPreferences(true);
    try {
      const result = await updateProfilePreferences(next);
      await onUserUpdated(result.user);
    } catch (error) {
      setPreferencesError(
        error instanceof Error
          ? error.message
          : tr(locale, 'Не удалось сохранить настройки.', 'Could not save preferences.'),
      );
    } finally {
      setSavingPreferences(false);
    }
  }

  if (section !== null) {
    const backToAudio = section === 'recordings';
    return (
      <section className="screen settings-detail-screen">
        <button
          className="settings-back"
          onClick={() => setSection(backToAudio ? 'audio' : null)}
          type="button"
        >
          ←{' '}
          {backToAudio
            ? tr(locale, 'Аудиокоманды', 'Audio commands')
            : tr(locale, 'Настройки', 'Settings')}
        </button>
        {section === 'preferences' && (
          <PreferenceSettings
            error={preferencesError}
            locale={locale}
            onSave={savePreferences}
            saving={savingPreferences}
            unitSystem={unitSystem}
          />
        )}
        {section === 'notifications' && <PushReminderSettings />}
        {section === 'audio' && (
          <>
            <VoiceCommandSettingsPanel />
            <div className="audio-command-sections">
              <MenuItem
                description={tr(
                  locale,
                  'Прослушать или удалить сохранённое аудио',
                  'Play or delete saved audio',
                )}
                icon="▶"
                onClick={() => setSection('recordings')}
                status={`${recordingCount}`}
                title={tr(locale, 'Записи команд', 'Command recordings')}
              />
            </div>
          </>
        )}
        {section === 'recordings' && <VoiceRecordingsPanel />}
        {section === 'coach' && (
          <>
            <p className="eyebrow">{tr(locale, 'Доступ', 'Access')}</p>
            <h1>{tr(locale, 'Тренер', 'Coach')}</h1>
            <TrainerRelationshipCard refreshKey={relationshipRefreshKey} />
          </>
        )}
        {section === 'data' && (
          <>
            <p className="eyebrow">{tr(locale, 'Личные данные', 'Personal data')}</p>
            <h1>{tr(locale, 'Данные и экспорт', 'Data and export')}</h1>
            <p className="intro">
              {tr(
                locale,
                'Сохрани локальную копию журнала или разбери изменения, которые требуют выбора.',
                'Save a local copy of your journal or review changes that need your decision.',
              )}
            </p>
            <DataExportPanel />
            {conflicts.length > 0 && (
              <ConflictSettings conflicts={conflicts} onResolveConflict={onResolveConflict} />
            )}
          </>
        )}
        {section === 'account' && (
          <>
            <p className="eyebrow">{tr(locale, 'Профиль', 'Profile')}</p>
            <h1>{tr(locale, 'Аккаунт', 'Account')}</h1>
            <ProfileCard user={user} />
            <button className="button danger full" onClick={onLogout} type="button">
              {tr(locale, 'Выйти из аккаунта', 'Sign out')}
            </button>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="screen settings-home">
      <div className="settings-home-heading">
        <div>
          <p className="eyebrow">{tr(locale, 'Профиль', 'Profile')}</p>
          <h1>{tr(locale, 'Настройки', 'Settings')}</h1>
        </div>
        <a
          className="settings-about-link"
          href="#about-mighty-cringe"
          onClick={(event) => {
            event.preventDefault();
            document.getElementById('about-mighty-cringe')?.scrollIntoView({
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 'auto'
                : 'smooth',
              block: 'start',
            });
          }}
        >
          {tr(locale, 'О приложении ↓', 'About ↓')}
        </a>
      </div>
      <div className="settings-menu">
        <MenuItem
          description={user.email}
          icon="R"
          onClick={() => setSection('account')}
          status={roleLabel(user.role, locale)}
          title={tr(locale, 'Аккаунт', 'Account')}
        />
        <MenuItem
          description={
            conflicts.length > 0
              ? tr(
                  locale,
                  'Есть изменения, которые требуют выбора',
                  'Some changes need your decision',
                )
              : tr(
                  locale,
                  'Локальная копия тренировок и замеров',
                  'Local copy of workouts and measurements',
                )
          }
          icon={conflicts.length > 0 ? '!' : '↓'}
          onClick={() => setSection('data')}
          status={conflicts.length > 0 ? `${conflicts.length}` : 'JSON'}
          title={tr(locale, 'Данные и экспорт', 'Data and export')}
          urgent={conflicts.length > 0}
        />
        <MenuItem
          description={tr(
            locale,
            'Кто может видеть тренировки и замеры',
            'Who can see workouts and measurements',
          )}
          icon="◎"
          onClick={() => setSection('coach')}
          status={
            coachName === undefined
              ? tr(locale, 'Проверяем…', 'Checking…')
              : (coachName ?? tr(locale, 'Не подключён', 'Not connected'))
          }
          title={tr(locale, 'Тренер и доступ', 'Coach and access')}
        />
        {onOpenTrainer && (
          <MenuItem
            description={tr(
              locale,
              'Приглашения и read-only просмотр',
              'Invitations and read-only access',
            )}
            icon="↗"
            onClick={onOpenTrainer}
            title={tr(locale, 'Подопечные', 'Athletes')}
          />
        )}
        <MenuItem
          description={tr(locale, 'Расписание и тихие часы', 'Schedule and quiet hours')}
          icon="◷"
          onClick={() => setSection('notifications')}
          status={
            notificationsEnabled === null
              ? tr(locale, 'Проверяем…', 'Checking…')
              : notificationsEnabled
                ? tr(locale, 'Включены', 'On')
                : tr(locale, 'Выключены', 'Off')
          }
          title={tr(locale, 'Уведомления', 'Notifications')}
        />
        <MenuItem
          description={tr(
            locale,
            'Согласие, обработка и приватность',
            'Consent, processing, and privacy',
          )}
          icon="⌁"
          onClick={() => setSection('audio')}
          status={
            audioStatus === 'ready'
              ? tr(locale, 'Включены', 'On')
              : audioStatus === 'consent'
                ? tr(locale, 'Нужно согласие', 'Consent needed')
                : audioStatus === 'unavailable'
                  ? tr(locale, 'Недоступны', 'Unavailable')
                  : tr(locale, 'Проверяем…', 'Checking…')
          }
          title={tr(locale, 'Аудиокоманды', 'Audio commands')}
        />
        <MenuItem
          description={tr(
            locale,
            'Язык интерфейса и отображение веса',
            'Interface language and weight display',
          )}
          icon="Aa"
          onClick={() => setSection('preferences')}
          status={`${locale === 'ru' ? 'Русский' : 'English'} · ${
            unitSystem === 'metric' ? tr(locale, 'кг / см', 'kg / cm') : 'lb / in'
          }`}
          title={tr(locale, 'Язык и единицы измерения', 'Language and units')}
        />
      </div>
      <AboutMightyCringe />
    </section>
  );
}

function PreferenceSettings({
  error,
  locale,
  onSave,
  saving,
  unitSystem,
}: {
  error: string | null;
  locale: CurrentUser['locale'];
  onSave: (next: {
    locale: CurrentUser['locale'];
    unitSystem: CurrentUser['unitSystem'];
  }) => Promise<void>;
  saving: boolean;
  unitSystem: CurrentUser['unitSystem'];
}) {
  return (
    <>
      <p className="eyebrow">{tr(locale, 'Интерфейс', 'Interface')}</p>
      <h1>{tr(locale, 'Язык и единицы измерения', 'Language and units')}</h1>
      <fieldset className="settings-choice-group">
        <legend>{tr(locale, 'Язык', 'Language')}</legend>
        <div className="segmented-control">
          <Choice
            active={locale === 'ru'}
            disabled={saving}
            label="Русский"
            onClick={() => void onSave({ locale: 'ru', unitSystem })}
          />
          <Choice
            active={locale === 'en'}
            disabled={saving}
            label="English"
            onClick={() => void onSave({ locale: 'en', unitSystem })}
          />
        </div>
      </fieldset>
      <fieldset className="settings-choice-group">
        <legend>{tr(locale, 'Единицы измерения', 'Units')}</legend>
        <div className="segmented-control">
          <Choice
            active={unitSystem === 'metric'}
            disabled={saving}
            label={tr(locale, 'Килограммы · сантиметры', 'Kilograms · centimetres')}
            onClick={() => void onSave({ locale, unitSystem: 'metric' })}
          />
          <Choice
            active={unitSystem === 'imperial'}
            disabled={saving}
            label="Pounds · inches"
            onClick={() => void onSave({ locale, unitSystem: 'imperial' })}
          />
        </div>
      </fieldset>
      {error && <p className="auth-error">{error}</p>}
    </>
  );
}

function AboutMightyCringe() {
  const { locale } = usePreferences();
  return (
    <section className="about-mighty-cringe" id="about-mighty-cringe">
      <img
        alt={tr(
          locale,
          'Медоед MightyCringe с гантелями',
          'MightyCringe honey badger with dumbbells',
        )}
        src="/icon-512.png"
      />
      <div>
        <p className="eyebrow">{tr(locale, 'О приложении', 'About')}</p>
        <p>
          {tr(
            locale,
            'Приложение для интенсивных силовых тренировок и учёта прогресса. Здесь можно быстро записывать подходы, следить за весами, повторами, замерами и личными рекордами.',
            'An app for intense strength training and progress tracking. Quickly log sets and follow weights, reps, measurements, and personal records.',
          )}
        </p>
        <p>
          {tr(
            locale,
            'Главная идея проста: в зале приложение не должно мешать тренировке. Минимум лишних действий — максимум честно зафиксированной работы.',
            'The main idea is simple: an app should not get in the way at the gym. Fewer unnecessary actions — more honestly recorded work.',
          )}
        </p>
        <p>
          {tr(
            locale,
            'Всем известно, что все силовые упражнения можно поделить на «Эпичные» (⚡ Mighty) и «Унизительные» (😬 Cringe). Отсюда и название 😁',
            'Everyone knows that every strength exercise can be either “Epic” (⚡ Mighty) or “Humiliating” (😬 Cringe). That is where the name comes from 😁',
          )}
        </p>
        <p>
          {tr(
            locale,
            'MightyCringe создан для людей, которые относятся к тренировкам серьёзно, но не слишком серьёзно относятся к себе.',
            'MightyCringe is made for people who take training seriously, but do not take themselves too seriously.',
          )}
        </p>
        <p>
          {tr(
            locale,
            'На иконке приложения — медоед, потому что ',
            'The app icon features a honey badger because ',
          )}
          <a
            className="about-mighty-cringe-story-link"
            href={
              locale === 'ru'
                ? 'https://www.youtube.com/watch?v=K7w6b4gs2-E'
                : 'https://www.youtube.com/watch?v=4r7wHMg5Yjg'
            }
            rel="noreferrer"
            target="_blank"
          >
            {tr(locale, 'он крут и ему на всё пофиг', 'he is cool and does not give a damn')}
          </a>
          .
        </p>
        <p className="about-mighty-cringe-author">
          {tr(
            locale,
            'Автор — Роман Баранов. Связаться с автором:',
            'Author — Roman Baranov. Contact the author:',
          )}
        </p>
        <div className="about-mighty-cringe-links">
          <a href="https://t.me/rbaranov" rel="noreferrer" target="_blank">
            tg @rbaranov
          </a>
          <a href="mailto:rbaranov@me.com">rbaranov@me.com</a>
        </div>
      </div>
    </section>
  );
}

function Choice({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={active ? 'active' : ''}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function MenuItem({
  description,
  icon,
  onClick,
  status,
  title,
  urgent = false,
}: {
  description: string;
  icon: string;
  onClick: () => void;
  status?: string;
  title: string;
  urgent?: boolean;
}) {
  return (
    <button
      className={urgent ? 'settings-menu-item urgent' : 'settings-menu-item'}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true" className="settings-menu-icon">
        {icon}
      </span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span className="settings-menu-end">
        {status && <small>{status}</small>}
        <b aria-hidden="true">→</b>
      </span>
    </button>
  );
}

function ProfileCard({ user }: { user: CurrentUser }) {
  const { locale } = usePreferences();
  return (
    <div className="profile-card">
      {user.avatarUrl && <img alt="" referrerPolicy="no-referrer" src={user.avatarUrl} />}
      <div>
        <strong>{user.displayName}</strong>
        <small>{user.email}</small>
      </div>
      <span>{roleLabel(user.role, locale)}</span>
    </div>
  );
}

function ConflictSettings({
  conflicts,
  onResolveConflict,
}: {
  conflicts: SyncConflict[];
  onResolveConflict: (conflict: SyncConflict, strategy: 'server' | 'mine') => void;
}) {
  const { locale } = usePreferences();
  return (
    <section className="conflict-panel" aria-live="polite">
      <p className="eyebrow">{tr(locale, 'Нужен выбор', 'Choose a version')}</p>
      <h2>{tr(locale, 'Конфликты синхронизации', 'Sync conflicts')}</h2>
      <p className="intro">
        {tr(
          locale,
          'Ничего не перезаписано автоматически. Выбери версию для каждой записи.',
          'Nothing was overwritten automatically. Choose a version for each entry.',
        )}
      </p>
      {!conflicts.length && (
        <p className="detail-empty">
          {tr(locale, 'Конфликтов синхронизации нет.', 'There are no sync conflicts.')}
        </p>
      )}
      {conflicts.map((conflict) => (
        <article className="conflict-card" key={conflict.id}>
          <strong>{conflictLabel(conflict, locale)}</strong>
          <small>{conflict.message}</small>
          <div>
            <button
              className="button ghost small"
              onClick={() => onResolveConflict(conflict, 'server')}
              type="button"
            >
              {conflict.current
                ? tr(locale, 'Оставить серверную', 'Keep server version')
                : tr(locale, 'Удалить локальную', 'Delete local version')}
            </button>
            <button
              className="button primary small"
              disabled={!canKeepMine(conflict)}
              onClick={() => onResolveConflict(conflict, 'mine')}
              type="button"
            >
              {tr(locale, 'Сохранить мою', 'Keep mine')}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

function conflictLabel(conflict: SyncConflict, locale: CurrentUser['locale']) {
  if (conflict.entityType === 'workout') return tr(locale, 'Тренировка', 'Workout');
  if (conflict.entityType === 'set') return tr(locale, 'Подход', 'Set');
  return tr(locale, 'Замер тела', 'Body measurement');
}

function roleLabel(role: CurrentUser['role'], locale: CurrentUser['locale']) {
  if (role === 'trainer') return tr(locale, 'Тренер', 'Coach');
  if (role === 'admin' || role === 'superadmin') return 'Admin';
  return 'Athlete';
}

function canKeepMine(conflict: SyncConflict) {
  return (
    conflict.mutation.type === 'workout.create' ||
    conflict.mutation.type === 'workout.update' ||
    conflict.mutation.type === 'workout.delete' ||
    conflict.mutation.type === 'set.update' ||
    conflict.mutation.type === 'measurement.update' ||
    (conflict.mutation.type === 'set.delete' && conflict.current !== null) ||
    (conflict.mutation.type === 'measurement.delete' && conflict.current !== null)
  );
}
