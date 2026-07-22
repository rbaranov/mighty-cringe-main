import { useEffect, useRef, useState } from 'react';

import { useLiveQuery } from 'dexie-react-hooks';

import { db, type LocalVoiceEntry } from '../lib/db';
import { tr, usePreferences } from '../lib/preferences';
import {
  flushVoiceQueue,
  loadVoiceConfig,
  queueVoiceRecording,
  refreshVoiceEntries,
  requestVoiceDeletion,
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
  onTranscript,
}: {
  activeWorkoutId: string | null;
  onTranscript: (transcript: string) => void;
}) {
  const { locale } = usePreferences();
  const [config, setConfig] = useState<VoiceConfig | null | undefined>(undefined);
  const [consented, setConsented] = useState(false);
  const [captureState, setCaptureState] = useState<'idle' | 'requesting' | 'recording' | 'saving'>(
    'idle',
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const capture = useRef<Capture | null>(null);
  const entries = useLiveQuery(
    () => db.voiceEntries.orderBy('createdAt').reverse().limit(5).toArray(),
    [],
    [],
  );

  useEffect(() => {
    void loadVoiceConfig().then(setConfig);
    void refreshVoiceEntries();
    return () => {
      const current = capture.current;
      if (!current) return;
      current.discard = true;
      clearTimeout(current.timer);
      if (current.recorder.state !== 'inactive') current.recorder.stop();
      current.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

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
    try {
      const entry = await queueVoiceRecording({
        workoutId: activeWorkoutId,
        audio,
        consentVersion: currentConfig.consentVersion,
      });
      if (audio.size > currentConfig.maximumBytes) {
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
      } else {
        await flushVoiceQueue();
        await refreshVoiceEntries();
      }
      setConsented(false);
      setCaptureState('idle');
    } catch {
      setCaptureState('idle');
      setError(
        tr(
          locale,
          'Не удалось сохранить запись на устройстве. Освободи место и попробуй снова.',
          'Could not save the recording on this device. Free some space and try again.',
        ),
      );
    }
  }

  async function deleteEntry(id: string) {
    setConfirmDeleteId(null);
    await requestVoiceDeletion(id);
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
      <div className="voice-consent">
        <strong>
          {tr(
            locale,
            'Перед каждой записью — явное согласие',
            'Explicit consent before every recording',
          )}
        </strong>
        <p>
          {tr(
            locale,
            'Аудио сразу сохранится на этом устройстве, затем уйдёт в приватное серверное хранилище и в',
            'Audio is saved on this device first, then sent to private server storage and to',
          )}{' '}
          {config.provider}{' '}
          {tr(
            locale,
            'только для расшифровки. Оно хранится до твоего явного удаления.',
            'for transcription only. It is retained until you explicitly delete it.',
          )}
        </p>
        <label>
          <input
            checked={consented}
            disabled={captureState !== 'idle'}
            onChange={(event) => setConsented(event.target.checked)}
            type="checkbox"
          />
          {tr(
            locale,
            'Я согласен на запись и описанную обработку этого аудио',
            'I agree to record and process this audio as described',
          )}
        </label>
      </div>

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
              {tr(locale, 'Остановить и сохранить', 'Stop and save')}
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
              : tr(locale, 'Согласен и начать запись', 'Agree and start recording')}
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

      {entries.length > 0 && (
        <div className="voice-history">
          <strong>{tr(locale, 'Последние записи', 'Recent recordings')}</strong>
          {entries.map((entry) => (
            <article key={entry.id}>
              <div>
                <span>{voiceStatusLabel(entry, locale)}</span>
                <small>{formatVoiceTime(entry.createdAt, locale)}</small>
              </div>
              {entry.transcript && <p>«{entry.transcript}»</p>}
              {entry.status !== 'deleting' && <VoicePlayback entry={entry} />}
              {entry.status === 'confirmed' && entry.transcript && (
                <button
                  className="button primary small"
                  onClick={() => onTranscript(entry.transcript!)}
                  type="button"
                >
                  {tr(locale, 'Разобрать расшифровку', 'Parse transcript')}
                </button>
              )}
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
      )}
    </div>
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
      return tr(locale, 'Сохранено — ждёт отправки', 'Saved — waiting to upload');
    case 'pending':
      return tr(locale, 'В очереди распознавания', 'Queued for transcription');
    case 'processing':
      return tr(locale, 'Распознаётся', 'Transcribing');
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
