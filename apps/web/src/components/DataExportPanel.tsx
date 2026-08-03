import { useState } from 'react';

import { useLiveQuery } from 'dexie-react-hooks';

import { deliverLocalDataExport, loadLocalDataExport } from '../lib/dataExport';
import { tr, usePreferences } from '../lib/preferences';

type ExportStatus = { kind: 'success' | 'error'; message: string } | null;

export function DataExportPanel() {
  const { locale, unitSystem } = usePreferences();
  const data = useLiveQuery(
    () => loadLocalDataExport({ locale, unitSystem }),
    [locale, unitSystem],
    null,
  );
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<ExportStatus>(null);
  const unsyncedRecords = data ? data.summary.pendingRecords + data.summary.conflictedRecords : 0;

  async function exportData() {
    if (!data || exporting) return;
    setExporting(true);
    setStatus(null);
    try {
      const delivery = await deliverLocalDataExport({
        ...data,
        exportedAt: new Date().toISOString(),
      });
      if (delivery === 'cancelled') return;
      setStatus({
        kind: 'success',
        message:
          delivery === 'shared'
            ? tr(
                locale,
                'Экспорт передан выбранному приложению.',
                'The export was sent to the selected app.',
              )
            : tr(locale, 'JSON-файл скачан.', 'The JSON file was downloaded.'),
      });
    } catch {
      setStatus({
        kind: 'error',
        message: tr(
          locale,
          'Не удалось сохранить файл. Данные в приложении не изменены — попробуй ещё раз.',
          'Could not save the file. Your in-app data is unchanged — please try again.',
        ),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <section aria-labelledby="data-export-heading" className="data-export-card">
      <div className="data-export-heading">
        <div>
          <p className="eyebrow">JSON</p>
          <h2 id="data-export-heading">
            {tr(locale, 'Копия данных этого устройства', 'Copy of this device’s data')}
          </h2>
        </div>
        <span>{tr(locale, 'Работает офлайн', 'Works offline')}</span>
      </div>
      <p>
        {tr(
          locale,
          'В файл попадут тренировки, подходы, замеры и используемые упражнения — включая записи, которые ещё не синхронизировались.',
          'The file includes workouts, sets, measurements, and used exercises — including records that have not synced yet.',
        )}
      </p>

      <div aria-live="polite" className="data-export-summary">
        <ExportCount
          label={tr(locale, 'Тренировки', 'Workouts')}
          loading={!data}
          value={data?.summary.workouts ?? 0}
        />
        <ExportCount
          label={tr(locale, 'Подходы', 'Sets')}
          loading={!data}
          value={data?.summary.sets ?? 0}
        />
        <ExportCount
          label={tr(locale, 'Замеры', 'Measurements')}
          loading={!data}
          value={data?.summary.measurements ?? 0}
        />
      </div>

      {data && unsyncedRecords > 0 && (
        <p className="data-export-unsynced">
          {tr(
            locale,
            `В копию войдут несинхронизированные записи: ${formatCount(unsyncedRecords, locale)}.`,
            `Unsynced records included: ${formatCount(unsyncedRecords, locale)}.`,
          )}
        </p>
      )}

      <button
        className="button primary full"
        disabled={!data || exporting}
        onClick={() => void exportData()}
        type="button"
      >
        {exporting
          ? tr(locale, 'Сохраняем…', 'Saving…')
          : tr(locale, 'Экспортировать JSON', 'Export JSON')}
      </button>
      <p className="data-export-note">
        {tr(
          locale,
          'На iPhone откроется системное меню — выбери «Сохранить в Файлы». Экспорт содержит личные данные; храни его в безопасном месте. Импорт в приложение пока не поддерживается.',
          'On iPhone, choose “Save to Files” in the system menu. The export contains personal data; keep it somewhere safe. Importing it back into the app is not supported yet.',
        )}
      </p>
      {status && (
        <p
          aria-live="polite"
          className={status.kind === 'error' ? 'data-export-status error' : 'data-export-status'}
          role={status.kind === 'error' ? 'alert' : 'status'}
        >
          {status.message}
        </p>
      )}
    </section>
  );
}

function ExportCount({
  label,
  loading,
  value,
}: {
  label: string;
  loading: boolean;
  value: number;
}) {
  const { locale } = usePreferences();
  return (
    <div>
      <strong>{loading ? '—' : formatCount(value, locale)}</strong>
      <span>{label}</span>
    </div>
  );
}

function formatCount(value: number, locale: 'ru' | 'en') {
  return value.toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US');
}
