import { useEffect, useRef, useState } from 'react';

import { useLiveQuery } from 'dexie-react-hooks';

import { db, type LocalVoiceEntry } from '../lib/db';
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
      setError('Не удалось получить доступ к микрофону. Проверь разрешение браузера.');
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
          lastError: 'Запись слишком большая. Удали её и запиши короче.',
        });
      } else {
        await flushVoiceQueue();
        await refreshVoiceEntries();
      }
      setConsented(false);
      setCaptureState('idle');
    } catch {
      setCaptureState('idle');
      setError('Не удалось сохранить запись на устройстве. Освободи место и попробуй снова.');
    }
  }

  async function deleteEntry(id: string) {
    setConfirmDeleteId(null);
    await requestVoiceDeletion(id);
  }

  if (config === undefined) {
    return <div className="voice-boundary">Проверяем приватную голосовую обработку…</div>;
  }
  if (!config?.enabled) {
    return (
      <div className="voice-boundary" role="status">
        <strong>Голосовой ввод ещё не настроен на сервере</strong>
        <p>
          Нужны отдельное приватное хранилище и серверный ключ распознавания. Текстовый ввод
          продолжает работать без них.
        </p>
      </div>
    );
  }

  return (
    <div className="voice-panel">
      <div className="voice-consent">
        <strong>Перед каждой записью — явное согласие</strong>
        <p>
          Аудио сразу сохранится на этом устройстве, затем уйдёт в приватное серверное хранилище и в{' '}
          {config.provider} только для расшифровки. Оно хранится до твоего явного удаления.
        </p>
        <label>
          <input
            checked={consented}
            disabled={captureState !== 'idle'}
            onChange={(event) => setConsented(event.target.checked)}
            type="checkbox"
          />
          Я согласен на запись и описанную обработку этого аудио
        </label>
      </div>

      {captureState === 'recording' ? (
        <div className="recording-controls" role="status">
          <span>● Идёт запись — максимум {config.maximumSeconds} сек.</span>
          <div>
            <button className="button primary" onClick={() => stopRecording(false)} type="button">
              Остановить и сохранить
            </button>
            <button className="button ghost" onClick={() => stopRecording(true)} type="button">
              Отменить
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
            ? 'Запрашиваем микрофон…'
            : captureState === 'saving'
              ? 'Сохраняем на устройстве…'
              : 'Согласен и начать запись'}
        </button>
      )}
      {!activeWorkoutId && <p className="voice-hint">Сначала начни тренировку.</p>}
      {error && (
        <p className="clarification compact" role="alert">
          {error}
        </p>
      )}

      {entries.length > 0 && (
        <div className="voice-history">
          <strong>Последние записи</strong>
          {entries.map((entry) => (
            <article key={entry.id}>
              <div>
                <span>{voiceStatusLabel(entry)}</span>
                <small>{formatVoiceTime(entry.createdAt)}</small>
              </div>
              {entry.transcript && <p>«{entry.transcript}»</p>}
              {entry.status !== 'deleting' && <VoicePlayback entry={entry} />}
              {entry.status === 'confirmed' && entry.transcript && (
                <button
                  className="button primary small"
                  onClick={() => onTranscript(entry.transcript!)}
                  type="button"
                >
                  Разобрать расшифровку
                </button>
              )}
              {confirmDeleteId === entry.id ? (
                <div className="voice-delete-confirm">
                  <span>Удалить аудио с устройства и сервера?</span>
                  <button onClick={() => void deleteEntry(entry.id)} type="button">
                    Да, удалить
                  </button>
                  <button onClick={() => setConfirmDeleteId(null)} type="button">
                    Отмена
                  </button>
                </div>
              ) : (
                <button
                  className="voice-delete"
                  disabled={entry.status === 'deleting'}
                  onClick={() => setConfirmDeleteId(entry.id)}
                  type="button"
                >
                  Удалить аудио
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
    <audio aria-label="Прослушать сохранённую запись" controls preload="metadata" src={source} />
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

function voiceStatusLabel(entry: LocalVoiceEntry) {
  switch (entry.status) {
    case 'queued':
    case 'uploading':
      return 'Сохранено — ждёт отправки';
    case 'pending':
      return 'В очереди распознавания';
    case 'processing':
      return 'Распознаётся';
    case 'confirmed':
      return 'Расшифровка готова · аудио хранится до удаления';
    case 'deleting':
      return 'Удаляем везде…';
    case 'failed':
      return entry.retryable ? 'Повторим автоматически' : 'Не удалось распознать';
  }
}

function formatVoiceTime(value: string) {
  return new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  );
}
