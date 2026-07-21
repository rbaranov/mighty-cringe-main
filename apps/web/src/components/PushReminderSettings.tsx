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

const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

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
        if (active) setError('Не удалось загрузить настройки напоминаний.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function validate() {
    if (
      isReminderInsideQuietHours(
        preferences.reminderTime,
        preferences.quietStart,
        preferences.quietEnd,
      )
    ) {
      setError('Время напоминания попадает в тихие часы. Выбери другое время.');
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
      setNotice('Напоминания включены на этом устройстве.');
    } catch (requestError) {
      if (subscribed) await unsubscribeFromPush().catch(() => undefined);
      setError(requestError instanceof Error ? requestError.message : 'Не удалось включить push.');
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
      setNotice('Расписание сохранено.');
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Не удалось сохранить расписание.',
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
      setNotice('Напоминания выключены.');
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Не удалось выключить напоминания.',
      );
    } finally {
      setSaving(false);
    }
  }

  const unavailable = !loading && (!config?.enabled || !pushIsSupported());

  return (
    <section className="push-settings" aria-live="polite">
      <div className="setting">
        <span>Напоминания</span>
        <strong>{loading ? 'Проверяем…' : preferences.enabled ? 'Включены' : 'Выключены'}</strong>
      </div>
      {!loading && (
        <div className="push-settings-panel">
          <p>
            Разрешение спрашивается только после нажатия. Напоминания не содержат тренировочных
            данных.
          </p>
          <div className="push-settings-grid">
            <label>
              Частота
              <select
                onChange={(event) =>
                  setPreferences({
                    ...preferences,
                    frequency: event.target.value as UpdateNotificationPreferences['frequency'],
                  })
                }
                value={preferences.frequency}
              >
                <option value="daily">Каждый день</option>
                <option value="weekdays">По будням</option>
                <option value="weekly">Раз в неделю</option>
              </select>
            </label>
            {preferences.frequency === 'weekly' && (
              <label>
                День
                <select
                  onChange={(event) =>
                    setPreferences({ ...preferences, weekday: Number(event.target.value) })
                  }
                  value={preferences.weekday}
                >
                  {weekdays.map((weekday, index) => (
                    <option key={weekday} value={index}>
                      {weekday}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Время
              <input
                onChange={(event) =>
                  setPreferences({ ...preferences, reminderTime: event.target.value })
                }
                type="time"
                value={preferences.reminderTime}
              />
            </label>
            <label>
              Тихие часы с
              <input
                onChange={(event) =>
                  setPreferences({ ...preferences, quietStart: event.target.value })
                }
                type="time"
                value={preferences.quietStart}
              />
            </label>
            <label>
              Тихие часы до
              <input
                onChange={(event) =>
                  setPreferences({ ...preferences, quietEnd: event.target.value })
                }
                type="time"
                value={preferences.quietEnd}
              />
            </label>
          </div>
          <small>Часовой пояс: {preferences.timeZone}</small>
          {unavailable && (
            <p className="auth-error">
              Push пока недоступен: открой установленную PWA в поддерживаемом браузере или дождись
              серверной настройки.
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
                  Сохранить
                </button>
                <button
                  className="button ghost small"
                  disabled={saving}
                  onClick={() => void disable()}
                  type="button"
                >
                  Выключить
                </button>
              </>
            ) : (
              <button
                className="button primary small"
                disabled={saving || unavailable}
                onClick={() => void enable()}
                type="button"
              >
                Разрешить и включить
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
