import { useEffect, useRef, useState } from 'react';

import { useLiveQuery } from 'dexie-react-hooks';

import { db, type LocalVoiceEntry } from '../lib/db';
import { tr, usePreferences } from '../lib/preferences';
import {
  acceptVoiceConsent,
  classifyVoiceLocalSaveFailure,
  flushVoiceQueue,
  hasAcceptedVoiceConsent,
  loadVoiceConfig,
  queueVoiceRecording,
  refreshVoiceEntries,
  requestVoiceDeletion,
  revokeVoiceConsent,
  waitForVoiceEntry,
  type VoiceConfig,
} from '../lib/voice';

type Capture = {
  recorder: MediaRecorder;
  stream: MediaStream;
  timer: ReturnType<typeof setTimeout>;
  discard: boolean;
};

export function VoicePanel({
  activeWorkoutId,
  autoStart = false,
  onTranscript,
}: {
  activeWorkoutId: string | null;
  autoStart?: boolean;
  onTranscript: (transcript: string) => void;
}) {
  const { locale } = usePreferences();
  const [config, setConfig] = useState<VoiceConfig | null | undefined>(undefined);
  const [consented, setConsented] = useState(false);
  const [captureState, setCaptureState] = useState<'idle' | 'requesting' | 'recording' | 'saving'>(
    'idle',
  );
  const [error, setError] = useState<string | null>(null);
  const [latestEntryId, setLatestEntryId] = useState<string | null>(null);
  const capture = useRef<Capture | null>(null);
  const autoStartAttempted = useRef(false);
  const deliveredTranscriptId = useRef<string | null>(null);
  const mounted = useRef(true);
  const transcriptHandler = useRef(onTranscript);
  const latestEntry = useLiveQuery(
    () => (latestEntryId ? db.voiceEntries.get(latestEntryId) : undefined),
    [latestEntryId],
  );

  useEffect(() => {
    transcriptHandler.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    mounted.current = true;
    void loadVoiceConfig().then(async (next) => {
      if (!mounted.current) return;
      setConfig(next);
      const accepted = next ? await hasAcceptedVoiceConsent(next.consentVersion) : false;
      if (mounted.current) setConsented(accepted);
    });
    void refreshVoiceEntries();
    return () => {
      mounted.current = false;
      const current = capture.current;
      if (!current) return;
      current.discard = true;
      clearTimeout(current.timer);
      if (current.recorder.state !== 'inactive') current.recorder.stop();
      current.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!latestEntryId) return;
    const controller = new AbortController();
    void waitForVoiceEntry(latestEntryId, { signal: controller.signal }).then((entry) => {
      if (
        controller.signal.aborted ||
        entry?.status !== 'confirmed' ||
        !entry.transcript ||
        deliveredTranscriptId.current === entry.id
      ) {
        return;
      }
      deliveredTranscriptId.current = entry.id;
      transcriptHandler.current(entry.transcript);
    });
    return () => controller.abort();
  }, [latestEntryId]);

  useEffect(() => {
    if (
      !autoStart ||
      autoStartAttempted.current ||
      !config?.enabled ||
      !consented ||
      !activeWorkoutId
    ) {
      return;
    }
    autoStartAttempted.current = true;
    void startRecording();
  }, [activeWorkoutId, autoStart, config, consented]);

  async function startRecording() {
    if (!config?.enabled || !consented || !activeWorkoutId || capture.current) return;
    setError(null);
    setCaptureState('requesting');
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('unsupported');
      }
      const activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream = activeStream;
      if (!mounted.current) {
        activeStream.getTracks().forEach((track) => track.stop());
        return;
      }
      const requestedMimeType = preferredMimeType();
      const recorder = new MediaRecorder(
        activeStream,
        requestedMimeType ? { mimeType: requestedMimeType } : undefined,
      );
      const chunks: BlobPart[] = [];
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener(
        'stop',
        () => {
          const current = capture.current;
          capture.current = null;
          activeStream.getTracks().forEach((track) => track.stop());
          if (!current || current.discard) {
            setCaptureState('idle');
            return;
          }
          const audio = new Blob(chunks, {
            type: recorder.mimeType || requestedMimeType || 'audio/webm',
          });
          void persistRecording(audio, config);
        },
        { once: true },
      );
      recorder.start(1_000);
      const timer = setTimeout(() => stopRecording(false), config.maximumSeconds * 1_000);
      capture.current = { recorder, stream: activeStream, timer, discard: false };
      setCaptureState('recording');
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      if (!mounted.current) return;
      setCaptureState('idle');
      setError(
        tr(
          locale,
          'Не удалось получить доступ к микрофону. Проверь разрешение браузера.',
          'Could not access the microphone. Check the browser permission.',
        ),
      );
    }
  }

  function stopRecording(discard: boolean) {
    const current = capture.current;
    if (!current) return;
    current.discard = discard;
    clearTimeout(current.timer);
    if (!discard) setCaptureState('saving');
    if (current.recorder.state !== 'inactive') current.recorder.stop();
  }

  async function persistRecording(audio: Blob, currentConfig: VoiceConfig) {
    let entry: LocalVoiceEntry;
    try {
      entry = await queueVoiceRecording({
        workoutId: activeWorkoutId,
        audio,
        consentVersion: currentConfig.consentVersion,
      });
    } catch (saveError) {
      setCaptureState('idle');
      setError(
        classifyVoiceLocalSaveFailure(saveError) === 'quota'
          ? tr(
              locale,
              'На устройстве действительно не хватает места для записи. Освободи место и попробуй снова.',
              'There really is not enough device storage for this recording. Free some space and try again.',
            )
          : tr(
              locale,
              'Не удалось сохранить запись в хранилище приложения. Перезапусти Mighty & Cringe и попробуй снова.',
              'Could not save the recording in app storage. Restart Mighty & Cringe and try again.',
            ),
      );
      return;
    }

    setLatestEntryId(entry.id);
    setCaptureState('idle');
    if (audio.size > currentConfig.maximumBytes) {
      try {
        await db.voiceEntries.update(entry.id, {
          status: 'failed',
          retryable: false,
          nextAttemptAt: null,
          lastError: tr(
            locale,
            'Запись слишком большая. Удали её и запиши короче.',
            'The recording is too large. Delete it and record a shorter one.',
          ),
        });
      } catch {
        setError(
          tr(
            locale,
            'Запись сохранена, но не удалось обновить её статус. Повторим автоматически.',
            'The recording was saved, but its status could not be updated. We will retry automatically.',
          ),
        );
      }
      return;
    }

    const syncOutcome = await flushVoiceQueue();
    if (syncOutcome === 'success') {
      await refreshVoiceEntries();
    }
  }

  if (config === undefined) {
    return (
      <div className="voice-boundary">
        {tr(
          locale,
          'Проверяем приватную голосовую обработку…',
          'Checking private voice processing…',
        )}
      </div>
    );
  }
  if (!config?.enabled) {
    return (
      <div className="voice-boundary" role="status">
        <strong>
          {tr(
            locale,
            'Голосовой ввод ещё не настроен на сервере',
            'Voice input is not configured on the server yet',
          )}
        </strong>
        <p>
          {tr(
            locale,
            'Нужны отдельное приватное хранилище и серверный ключ распознавания. Текстовый ввод продолжает работать без них.',
            'A private storage bucket and server-side transcription key are required. Text input keeps working without them.',
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="voice-panel">
      {!consented && (
        <div className="voice-consent">
          <strong>
            {tr(locale, 'Одно согласие для быстрых записей', 'Consent once for quick recordings')}
          </strong>
          <p>
            {tr(
              locale,
              'Аудио сначала сохранится на устройстве, затем уйдёт в приватное хранилище и в',
              'Audio is saved on this device first, then sent to private storage and to',
            )}{' '}
            {config.provider}{' '}
            {tr(
              locale,
              'только для расшифровки. Оно хранится до твоего явного удаления. Условия и архив доступны в настройках.',
              'for transcription only. It is retained until you delete it. Terms and recordings are available in Settings.',
            )}
          </p>
          <button
            className="button primary full"
            onClick={() =>
              void acceptVoiceConsent(config.consentVersion).then(() => setConsented(true))
            }
            type="button"
          >
            {tr(locale, 'Принять и продолжить', 'Accept and continue')}
          </button>
        </div>
      )}

      {captureState === 'recording' ? (
        <div className="recording-controls" role="status">
          <span>
            ●{' '}
            {tr(
              locale,
              `Идёт запись — максимум ${config.maximumSeconds} сек.`,
              `Recording — up to ${config.maximumSeconds} sec.`,
            )}
          </span>
          <div>
            <button className="button primary" onClick={() => stopRecording(false)} type="button">
              {tr(locale, 'Остановить', 'Stop')}
            </button>
            <button className="button ghost" onClick={() => stopRecording(true)} type="button">
              {tr(locale, 'Отменить', 'Cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="button primary full"
          disabled={!activeWorkoutId || !consented || captureState !== 'idle'}
          onClick={() => void startRecording()}
          type="button"
        >
          {captureState === 'requesting'
            ? tr(locale, 'Запрашиваем микрофон…', 'Requesting microphone…')
            : captureState === 'saving'
              ? tr(locale, 'Сохраняем на устройстве…', 'Saving on device…')
              : tr(locale, 'Начать запись', 'Start recording')}
        </button>
      )}
      {!activeWorkoutId && (
        <p className="voice-hint">
          {tr(locale, 'Сначала начни тренировку.', 'Start a workout first.')}
        </p>
      )}
      {error && (
        <p className="clarification compact" role="alert">
          {error}
        </p>
      )}
      {latestEntry && (
        <p className="voice-live-status" role="status">
          {latestEntry.status === 'confirmed' && latestEntry.transcript
            ? `«${latestEntry.transcript}»`
            : voiceStatusLabel(latestEntry, locale)}
        </p>
      )}
    </div>
  );
}

export function VoiceSettingsPanel() {
  const { locale } = usePreferences();
  const [config, setConfig] = useState<VoiceConfig | null | undefined>(undefined);
  const [consented, setConsented] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const entries = useLiveQuery(
    () => db.voiceEntries.orderBy('createdAt').reverse().toArray(),
    [],
    [],
  );

  useEffect(() => {
    void loadVoiceConfig().then(async (next) => {
      setConfig(next);
      setConsented(next ? await hasAcceptedVoiceConsent(next.consentVersion) : false);
    });
    void refreshVoiceEntries();
  }, []);

  async function deleteEntry(id: string) {
    setConfirmDeleteId(null);
    await requestVoiceDeletion(id);
  }

  return (
    <section className="voice-settings-panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">{tr(locale, 'Приватность', 'Privacy')}</p>
          <h2>{tr(locale, 'Голос и записи', 'Voice and recordings')}</h2>
        </div>
        {config?.enabled && (
          <span className={consented ? 'voice-consent-status accepted' : 'voice-consent-status'}>
            {consented
              ? tr(locale, 'согласие принято', 'consent accepted')
              : tr(locale, 'не принято', 'not accepted')}
          </span>
        )}
      </div>
      <p className="voice-settings-copy">
        {tr(
          locale,
          'Записи хранятся приватно до удаления. Согласие действует для текущей версии условий и не спрашивается перед каждым подходом.',
          'Recordings stay private until deletion. Consent applies to the current terms and is not requested before every set.',
        )}
      </p>
      {consented && (
        <button
          className="button ghost small"
          onClick={() =>
            void revokeVoiceConsent().then(() => {
              setConsented(false);
            })
          }
          type="button"
        >
          {tr(locale, 'Отозвать согласие', 'Revoke consent')}
        </button>
      )}
      <div className="voice-history">
        <strong>{tr(locale, 'Архив записей', 'Recording archive')}</strong>
        {!entries.length && (
          <p className="detail-empty">{tr(locale, 'Записей пока нет.', 'No recordings yet.')}</p>
        )}
        {entries.map((entry) => (
          <article key={entry.id}>
            <div>
              <span>{voiceStatusLabel(entry, locale)}</span>
              <small>{formatVoiceTime(entry.createdAt, locale)}</small>
            </div>
            {entry.transcript && <p>«{entry.transcript}»</p>}
            {entry.status !== 'deleting' && <VoicePlayback entry={entry} />}
            {confirmDeleteId === entry.id ? (
              <div className="voice-delete-confirm">
                <span>
                  {tr(
                    locale,
                    'Удалить аудио с устройства и сервера?',
                    'Delete audio from the device and server?',
                  )}
                </span>
                <button onClick={() => void deleteEntry(entry.id)} type="button">
                  {tr(locale, 'Да, удалить', 'Delete')}
                </button>
                <button onClick={() => setConfirmDeleteId(null)} type="button">
                  {tr(locale, 'Отмена', 'Cancel')}
                </button>
              </div>
            ) : (
              <button
                className="voice-delete"
                disabled={entry.status === 'deleting'}
                onClick={() => setConfirmDeleteId(entry.id)}
                type="button"
              >
                {tr(locale, 'Удалить аудио', 'Delete audio')}
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function VoicePlayback({ entry }: { entry: LocalVoiceEntry }) {
  const { locale } = usePreferences();
  const [source, setSource] = useState(
    entry.audio ? '' : entry.serverStored ? `/api/v1/voice-entries/${entry.id}/audio` : '',
  );

  useEffect(() => {
    if (!entry.audio) {
      setSource(entry.serverStored ? `/api/v1/voice-entries/${entry.id}/audio` : '');
      return;
    }
    const localSource = URL.createObjectURL(entry.audio);
    setSource(localSource);
    return () => URL.revokeObjectURL(localSource);
  }, [entry.audio, entry.id, entry.serverStored]);

  if (!source) return null;
  return (
    <audio
      aria-label={tr(locale, 'Прослушать сохранённую запись', 'Play saved recording')}
      controls
      preload="metadata"
      src={source}
    />
  );
}

function preferredMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function voiceStatusLabel(entry: LocalVoiceEntry, locale: 'ru' | 'en') {
  switch (entry.status) {
    case 'queued':
    case 'uploading':
      return tr(locale, 'Сохраняю и отправляю…', 'Saving and uploading…');
    case 'pending':
    case 'processing':
      return tr(locale, 'Распознаю и разбираю…', 'Transcribing and parsing…');
    case 'confirmed':
      return tr(
        locale,
        'Расшифровка готова · аудио хранится до удаления',
        'Transcript ready · audio retained until deletion',
      );
    case 'deleting':
      return tr(locale, 'Удаляем везде…', 'Deleting everywhere…');
    case 'failed':
      return entry.retryable
        ? tr(locale, 'Повторим автоматически', 'Will retry automatically')
        : tr(locale, 'Не удалось распознать', 'Transcription failed');
  }
}

function formatVoiceTime(value: string, locale: 'ru' | 'en') {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
