import { useEffect, useState } from 'react';

import type { UpdateNotificationPreferences } from '@mighty-cringe/contracts';

import {
  getNotificationSettings,
  isReminderInsideQuietHours,
  pushIsSupported,
  subscribeToPush,
  unsubscribeFromPush,
  updateNotificationPreferences,
  type NotificationConfig,
} from '../lib/notifications';
import { tr, usePreferences } from '../lib/preferences';

const weekdayLabels = {
  ru: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

const initialPreferences: UpdateNotificationPreferences = {
  enabled: false,
  frequency: 'daily',
  weekday: 1,
  reminderTime: '19:00',
  quietStart: '22:00',
  quietEnd: '08:00',
  timeZone: 'UTC',
};

export function PushReminderSettings() {
  const { locale } = usePreferences();
  const [config, setConfig] = useState<NotificationConfig | null>(null);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getNotificationSettings()
      .then((settings) => {
        if (!active) return;
        setConfig(settings.config);
        setPreferences({
          ...settings.preferences,
          timeZone:
            settings.preferences.enabled || settings.preferences.timeZone !== 'UTC'
              ? settings.preferences.timeZone
              : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        });
      })
      .catch(() => {
        if (active) {
          setError(
            tr(
              locale,
              'Не удалось загрузить настройки напоминаний.',
              'Could not load reminder settings.',
            ),
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locale]);

  function validate() {
    if (
      isReminderInsideQuietHours(
        preferences.reminderTime,
        preferences.quietStart,
        preferences.quietEnd,
      )
    ) {
      setError(
        tr(
          locale,
          'Время напоминания попадает в тихие часы. Выбери другое время.',
          'The reminder falls inside quiet hours. Choose another time.',
        ),
      );
      return false;
    }
    return true;
  }

  async function enable() {
    setError(null);
    setNotice(null);
    if (!validate() || !config?.publicKey) return;
    setSaving(true);
    let subscribed = false;
    try {
      await subscribeToPush(config.publicKey);
      subscribed = true;
      const result = await updateNotificationPreferences({ ...preferences, enabled: true });
      setPreferences(result.preferences);
      setNotice(
        tr(
          locale,
          'Напоминания включены на этом устройстве.',
          'Reminders are enabled on this device.',
        ),
      );
    } catch (requestError) {
      if (subscribed) await unsubscribeFromPush().catch(() => undefined);
      setError(
        requestError instanceof Error
          ? requestError.message
          : tr(locale, 'Не удалось включить push.', 'Could not enable push notifications.'),
      );
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    setError(null);
    setNotice(null);
    if (!validate()) return;
    setSaving(true);
    try {
      const result = await updateNotificationPreferences(preferences);
      setPreferences(result.preferences);
      setNotice(tr(locale, 'Расписание сохранено.', 'Schedule saved.'));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : tr(locale, 'Не удалось сохранить расписание.', 'Could not save the schedule.'),
      );
    } finally {
      setSaving(false);
    }
  }

  async function disable() {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const result = await updateNotificationPreferences({ ...preferences, enabled: false });
      await unsubscribeFromPush();
      setPreferences(result.preferences);
      setNotice(tr(locale, 'Напоминания выключены.', 'Reminders are off.'));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : tr(locale, 'Не удалось выключить напоминания.', 'Could not disable reminders.'),
      );
    } finally {
      setSaving(false);
    }
  }

  const unavailable = !loading && (!config?.enabled || !pushIsSupported());

  return (
    <section className="push-settings" aria-live="polite">
      <p className="eyebrow">{tr(locale, 'Расписание', 'Schedule')}</p>
      <h1>{tr(locale, 'Уведомления', 'Notifications')}</h1>
      <div className="setting">
        <span>{tr(locale, 'Напоминания', 'Reminders')}</span>
        <strong>
          {loading
            ? tr(locale, 'Проверяем…', 'Checking…')
            : preferences.enabled
              ? tr(locale, 'Включены', 'On')
              : tr(locale, 'Выключены', 'Off')}
        </strong>
      </div>
      {!loading && (
        <div className="push-settings-panel">
          <p>
            {tr(
              locale,
              'Разрешение спрашивается только после нажатия. Напоминания не содержат тренировочных данных.',
              'Permission is requested only after you tap the button. Reminders contain no workout data.',
            )}
          </p>
          <div className="push-settings-grid">
            <label>
              {tr(locale, 'Частота', 'Frequency')}
              <select
                onChange={(event) =>
                  setPreferences({
                    ...preferences,
                    frequency: event.target.value as UpdateNotificationPreferences['frequency'],
                  })
                }
                value={preferences.frequency}
              >
                <option value="daily">{tr(locale, 'Каждый день', 'Daily')}</option>
                <option value="weekdays">{tr(locale, 'По будням', 'Weekdays')}</option>
                <option value="weekly">{tr(locale, 'Раз в неделю', 'Weekly')}</option>
              </select>
            </label>
            {preferences.frequency === 'weekly' && (
              <label>
                {tr(locale, 'День', 'Day')}
                <select
                  onChange={(event) =>
                    setPreferences({ ...preferences, weekday: Number(event.target.value) })
                  }
                  value={preferences.weekday}
                >
                  {weekdayLabels[locale].map((weekday, index) => (
                    <option key={weekday} value={index}>
                      {weekday}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {tr(locale, 'Время', 'Time')}
              <input
                onChange={(event) =>
                  setPreferences({ ...preferences, reminderTime: event.target.value })
                }
                type="time"
                value={preferences.reminderTime}
              />
            </label>
            <label>
              {tr(locale, 'Тихие часы с', 'Quiet hours from')}
              <input
                onChange={(event) =>
                  setPreferences({ ...preferences, quietStart: event.target.value })
                }
                type="time"
                value={preferences.quietStart}
              />
            </label>
            <label>
              {tr(locale, 'Тихие часы до', 'Quiet hours until')}
              <input
                onChange={(event) =>
                  setPreferences({ ...preferences, quietEnd: event.target.value })
                }
                type="time"
                value={preferences.quietEnd}
              />
            </label>
          </div>
          <small>
            {tr(locale, 'Часовой пояс', 'Time zone')}: {preferences.timeZone}
          </small>
          {unavailable && (
            <p className="auth-error">
              {tr(
                locale,
                'Push пока недоступен: открой установленную PWA в поддерживаемом браузере или дождись серверной настройки.',
                'Push is unavailable: open the installed PWA in a supported browser or wait for server configuration.',
              )}
            </p>
          )}
          {error && <p className="auth-error">{error}</p>}
          {notice && <p className="push-notice">{notice}</p>}
          <div className="push-actions">
            {preferences.enabled ? (
              <>
                <button
                  className="button primary small"
                  disabled={saving}
                  onClick={() => void save()}
                  type="button"
                >
                  {tr(locale, 'Сохранить', 'Save')}
                </button>
                <button
                  className="button ghost small"
                  disabled={saving}
                  onClick={() => void disable()}
                  type="button"
                >
                  {tr(locale, 'Выключить', 'Turn off')}
                </button>
              </>
            ) : (
              <button
                className="button primary small"
                disabled={saving || unavailable}
                onClick={() => void enable()}
                type="button"
              >
                {tr(locale, 'Разрешить и включить', 'Allow and enable')}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
