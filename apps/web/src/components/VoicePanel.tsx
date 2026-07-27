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
  startedAt: number;
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
  const [captureState, setCaptureState] = useState<
    'idle' | 'requesting' | 'recording' | 'saving' | 'cancelling'
  >('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [latestEntryId, setLatestEntryId] = useState<string | null>(null);
  const capture = useRef<Capture | null>(null);
  const autoStartAttempted = useRef(false);
  const cancelRequested = useRef(false);
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
    void (async () => {
      const next = await loadVoiceConfig();
      const accepted = next ? await hasAcceptedVoiceConsent(next.consentVersion) : false;
      if (!mounted.current) return;
      setConsented(accepted);
      setConfig(next);
    })();
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

  useEffect(() => {
    if (captureState !== 'recording') {
      setRecordingSeconds(0);
      return;
    }
    const updateElapsed = () => {
      const startedAt = capture.current?.startedAt;
      if (startedAt) setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    };
    updateElapsed();
    const interval = setInterval(updateElapsed, 250);
    return () => clearInterval(interval);
  }, [captureState]);

  async function startRecording() {
    if (!config?.enabled || !consented || !activeWorkoutId || capture.current) return;
    cancelRequested.current = false;
    setLatestEntryId(null);
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
      capture.current = {
        recorder,
        stream: activeStream,
        timer,
        startedAt: Date.now(),
        discard: false,
      };
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
              'Не удалось сохранить запись в хранилище приложения. Перезапусти MightyCringe и попробуй снова.',
              'Could not save the recording in app storage. Restart MightyCringe and try again.',
            ),
      );
      return;
    }

    if (cancelRequested.current) {
      try {
        await requestVoiceDeletion(entry.id);
      } catch {
        setError(
          tr(
            locale,
            'Не удалось отменить обработку. Запись можно удалить в настройках.',
            'Could not cancel processing. You can delete the recording in Settings.',
          ),
        );
      }
      if (mounted.current) setCaptureState('idle');
      return;
    }

    setLatestEntryId(entry.id);
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
      setCaptureState('idle');
      return;
    }

    const syncOutcome = await flushVoiceQueue();
    if (syncOutcome === 'success') {
      await refreshVoiceEntries();
    }
    if (cancelRequested.current) {
      try {
        await requestVoiceDeletion(entry.id);
      } catch {
        setError(
          tr(
            locale,
            'Не удалось отменить обработку. Запись можно удалить в настройках.',
            'Could not cancel processing. You can delete the recording in Settings.',
          ),
        );
      }
      if (mounted.current) setCaptureState('idle');
      return;
    }
    if (mounted.current) setCaptureState('idle');
  }

  async function cancelProcessing() {
    cancelRequested.current = true;
    const entryId = latestEntryId;
    const saveInProgress = captureState === 'saving';
    if (entryId) {
      deliveredTranscriptId.current = entryId;
      setLatestEntryId(null);
    }
    setCaptureState('cancelling');
    if (!entryId || saveInProgress) return;

    try {
      await requestVoiceDeletion(entryId);
    } catch {
      setError(
        tr(
          locale,
          'Не удалось отменить обработку. Запись можно удалить в настройках.',
          'Could not cancel processing. You can delete the recording in Settings.',
        ),
      );
    } finally {
      if (mounted.current) setCaptureState('idle');
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

  const isProcessing =
    captureState === 'saving' ||
    captureState === 'cancelling' ||
    Boolean(
      latestEntry && ['queued', 'uploading', 'pending', 'processing'].includes(latestEntry.status),
    );

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
        <div className="voice-recording-stage" role="status">
          <div className="voice-recording-head">
            <span className="voice-recording-live">
              <i aria-hidden="true" />
              {tr(locale, 'Запись', 'Recording')}
            </span>
            <span className="voice-recording-limit">
              {tr(
                locale,
                `до ${formatVoiceDuration(config.maximumSeconds)}`,
                `up to ${formatVoiceDuration(config.maximumSeconds)}`,
              )}
            </span>
          </div>
          <div className="voice-recording-visual" aria-hidden="true">
            <span className="voice-recording-mic">
              <svg viewBox="0 0 24 24">
                <path d="M12 15.5a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v5.5a4 4 0 0 0 4 4Zm-7-4a7 7 0 0 0 14 0M12 18.5V22M8.5 22h7" />
              </svg>
            </span>
            <span className="voice-wave">
              {Array.from({ length: 11 }, (_, index) => (
                <i key={index} />
              ))}
            </span>
          </div>
          <strong>{tr(locale, 'Говори, я слушаю', 'Go ahead, I’m listening')}</strong>
          <time>{formatVoiceDuration(recordingSeconds)}</time>
          <div className="voice-recording-actions">
            <button
              className="voice-stop-button"
              onClick={() => stopRecording(false)}
              type="button"
            >
              <span aria-hidden="true" />
              {tr(locale, 'Остановить', 'Stop')}
            </button>
            <button
              className="voice-cancel-button"
              onClick={() => stopRecording(true)}
              type="button"
            >
              {tr(locale, 'Отменить', 'Cancel')}
            </button>
          </div>
        </div>
      ) : isProcessing ? (
        <VoiceProcessingStage
          cancelling={captureState === 'cancelling'}
          locale={locale}
          onCancel={() => void cancelProcessing()}
        />
      ) : (
        <button
          className="button primary full"
          disabled={!activeWorkoutId || !consented || captureState !== 'idle'}
          onClick={() => void startRecording()}
          type="button"
        >
          {captureState === 'requesting'
            ? tr(locale, 'Запрашиваем микрофон…', 'Requesting microphone…')
            : tr(locale, 'Дать команду', 'Give a command')}
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
      {latestEntry && !isProcessing && (
        <p className="voice-live-status" role="status">
          {latestEntry.status === 'confirmed' && latestEntry.transcript
            ? `«${latestEntry.transcript}»`
            : voiceStatusLabel(latestEntry, locale)}
        </p>
      )}
    </div>
  );
}

export function VoiceProcessingStage({
  cancelling = false,
  locale,
  onCancel,
}: {
  cancelling?: boolean;
  locale: 'ru' | 'en';
  onCancel: () => void;
}) {
  return (
    <div className="voice-processing-stage" role="status">
      <span className="voice-processing-kicker">
        {tr(locale, 'Голос принят', 'Voice received')}
      </span>
      <strong>{tr(locale, 'Распознаю команду', 'Transcribing command')}</strong>
      <div className="voice-processing-signal" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => (
          <i key={index} />
        ))}
      </div>
      <p>
        {tr(
          locale,
          'Сверяю фразу с текущей тренировкой.',
          'Matching the phrase to your current workout.',
        )}
      </p>
      <button
        className="voice-processing-cancel"
        disabled={cancelling}
        onClick={onCancel}
        type="button"
      >
        {cancelling ? tr(locale, 'Отменяю…', 'Cancelling…') : tr(locale, 'Отменить', 'Cancel')}
      </button>
    </div>
  );
}

export function VoiceCommandSettingsPanel() {
  const { locale } = usePreferences();
  const [config, setConfig] = useState<VoiceConfig | null | undefined>(undefined);
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    void (async () => {
      const next = await loadVoiceConfig();
      const accepted = next ? await hasAcceptedVoiceConsent(next.consentVersion) : false;
      setConsented(accepted);
      setConfig(next);
    })();
  }, []);

  return (
    <section className="voice-settings-panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">{tr(locale, 'Приватность', 'Privacy')}</p>
          <h2>{tr(locale, 'Аудиокоманды', 'Audio commands')}</h2>
        </div>
        {config?.enabled && (
          <span className={consented ? 'voice-consent-status accepted' : 'voice-consent-status'}>
            {consented
              ? tr(locale, 'включены', 'on')
              : tr(locale, 'нужно согласие', 'consent needed')}
          </span>
        )}
      </div>
      <p className="voice-settings-copy">
        {tr(
          locale,
          'Запись начинается только после твоего действия. Аудио хранится приватно до удаления и используется для расшифровки команды.',
          'Recording starts only after your action. Audio stays private until deletion and is used to transcribe the command.',
        )}
      </p>
      {config === undefined && (
        <p className="detail-empty">{tr(locale, 'Проверяем настройки…', 'Checking settings…')}</p>
      )}
      {config && (
        <dl className="voice-config-facts">
          <div>
            <dt>{tr(locale, 'Обработка', 'Processing')}</dt>
            <dd>{config.provider ?? tr(locale, 'Не настроена', 'Not configured')}</dd>
          </div>
          <div>
            <dt>{tr(locale, 'Максимум записи', 'Recording limit')}</dt>
            <dd>
              {config.maximumSeconds} {tr(locale, 'сек.', 'sec.')}
            </dd>
          </div>
        </dl>
      )}
      {config && !config.enabled && (
        <p className="auth-error">
          {tr(
            locale,
            'Аудиокоманды пока выключены на сервере.',
            'Audio commands are currently disabled on the server.',
          )}
        </p>
      )}
      {config?.enabled &&
        (consented ? (
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
        ) : (
          <button
            className="button primary small"
            onClick={() =>
              void acceptVoiceConsent(config.consentVersion).then(() => {
                setConsented(true);
              })
            }
            type="button"
          >
            {tr(locale, 'Принять и включить', 'Accept and enable')}
          </button>
        ))}
    </section>
  );
}

export function VoiceRecordingsPanel() {
  const { locale } = usePreferences();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const entries = useLiveQuery(
    () => db.voiceEntries.orderBy('createdAt').reverse().toArray(),
    [],
    [],
  );

  useEffect(() => {
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
          <p className="eyebrow">{tr(locale, 'Хранилище', 'Storage')}</p>
          <h2>{tr(locale, 'Записи команд', 'Command recordings')}</h2>
        </div>
        <span className="voice-consent-status accepted">
          {entries.length}{' '}
          {tr(
            locale,
            entries.length === 1 ? 'запись' : 'записей',
            entries.length === 1 ? 'record' : 'records',
          )}
        </span>
      </div>
      <p className="voice-settings-copy">
        {tr(
          locale,
          'Здесь можно прослушать и удалить аудио с устройства и сервера. Удаление не стирает уже подтверждённый подход.',
          'Play or delete audio from the device and server here. Deleting audio does not erase an already confirmed set.',
        )}
      </p>
      <div className="voice-history">
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

export function VoiceSettingsPanel() {
  return (
    <>
      <VoiceCommandSettingsPanel />
      <VoiceRecordingsPanel />
    </>
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

function formatVoiceDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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
        : tr(
            locale,
            'Не расслышал команду. Попробуй ещё раз.',
            'Could not hear a command. Please try again.',
          );
  }
}

function formatVoiceTime(value: string, locale: 'ru' | 'en') {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
