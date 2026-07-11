'use client';

// useChatAudio — the client audio hook for the chat composer. Owns the browser I/O (MediaRecorder,
// HTMLAudioElement, speechSynthesis) and drives the PURE state machines in `@/lib/chat-audio`. The
// component stays dumb: it renders from `record`/`speak` state and calls the returned handlers.
//
// STT: record a clip → POST /api/v1/chat/transcribe → transcript merged into the composer.
// TTS: play an answer → POST /api/v1/chat/speak (on-prem) with a local browser-voice fallback.
//      Supports pause / resume / stop, and only ONE message speaks at a time.
// Everything is on-prem / in-browser — no cloud API is ever contacted.

import { type SpeechModel, defaultVoice } from '@offgrid/speech';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AudioConfigView,
  type RecordPhase,
  type SpeakPhase,
  audioFilename,
  chooseRecorderMime,
  isCapturing,
  mergeTranscript,
  nextRecordPhase,
  nextSpeakPhase,
  recordButtonLabel,
  speakBackend,
  speakButtonLabel,
  textForSpeech,
} from '@/lib/chat-audio';

/** The speech-model catalog + defaults the audio-config route ships alongside availability. */
interface AudioModelCatalog {
  stt: SpeechModel[];
  tts: SpeechModel[];
  defaultStt: string;
  defaultTts: string;
  defaultVoice: string | null;
}
type AudioConfig = AudioConfigView & { models?: AudioModelCatalog };

function browserSpeechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined';
}

export interface ChatAudioHook {
  /** STT config availability (drives mic disabled state + tooltip). */
  sttAvailable: boolean;
  /** Whether ANY speak backend (server TTS or browser voice) is usable. */
  ttsAvailable: boolean;
  /** Mic record phase. */
  recordPhase: RecordPhase;
  recording: boolean;
  micLabel: string;
  /** Toggle recording (start/stop). Resolves the transcript into the composer via onTranscript. */
  toggleRecording: () => Promise<void>;
  /** The message id currently speaking (or null). Lets the row show the active state. */
  speakingId: string | null;
  speakPhase: SpeakPhase;
  /** Play/pause/resume a message's answer. Same id while playing → pause/resume; different id → switch. */
  speak: (id: string, text: string) => Promise<void>;
  /** Hard stop any playback. */
  stopSpeaking: () => void;
  /** Tooltip for a given message's play button. */
  speakLabel: (id: string) => string;

  // ── Engine / voice picker (catalog-driven; degrades to gateway default) ──────
  /** Selectable STT engines from the catalog ([] until the config probe resolves). */
  sttModels: SpeechModel[];
  /** Selectable TTS engines from the catalog. */
  ttsModels: SpeechModel[];
  /** Currently selected STT engine id ('' = gateway default). */
  sttModel: string;
  setSttModel: (id: string) => void;
  /** Currently selected TTS engine id ('' = gateway default). */
  ttsModel: string;
  setTtsModel: (id: string) => void;
  /** Voices for the selected TTS engine (empty for a voiceless model). */
  ttsVoices: SpeechModel['voices'];
  /** Currently selected TTS voice id. */
  ttsVoice: string;
  setTtsVoice: (id: string) => void;
}

export function useChatAudio(opts: {
  onTranscript: (merge: (existing: string) => string) => void;
  onError?: (msg: string) => void;
}): ChatAudioHook {
  const { onTranscript, onError } = opts;
  const notify = useCallback((m: string) => onError?.(m), [onError]);

  // ── config ──────────────────────────────────────────────────────────────
  const [config, setConfig] = useState<AudioConfig | null>(null);
  // Picker selections. '' means "let the gateway pick its default" (fully backward-compatible with
  // the pre-picker behavior — no model field is sent). Defaulted from the catalog once it loads.
  const [sttModel, setSttModel] = useState('');
  const [ttsModel, setTtsModel] = useState('');
  const [ttsVoice, setTtsVoice] = useState('');
  useEffect(() => {
    let live = true;
    fetch('/api/v1/chat/audio-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!live || !c) return;
        const cfg = c as AudioConfig;
        setConfig(cfg);
        // Seed the picker to the catalog defaults (Parakeet / Orpheus when available).
        if (cfg.models) {
          setSttModel((prev) => prev || cfg.models!.defaultStt);
          setTtsModel((prev) => prev || cfg.models!.defaultTts);
          setTtsVoice((prev) => prev || cfg.models!.defaultVoice || '');
        }
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  const sttAvailable = config?.stt.available ?? true; // optimistic until probe resolves
  const serverTts = config?.tts.serverAvailable ?? false;
  const browserTts = browserSpeechAvailable();
  const backend = speakBackend(serverTts, browserTts);
  const ttsAvailable = backend !== 'none';

  const sttModels = useMemo(() => config?.models?.stt ?? [], [config]);
  const ttsModels = useMemo(() => config?.models?.tts ?? [], [config]);
  const ttsVoices = useMemo(
    () => ttsModels.find((m) => m.id === ttsModel)?.voices ?? [],
    [ttsModels, ttsModel],
  );
  // Keep the voice coherent when the engine changes: reset to the new engine's default voice.
  const setTtsModelAndVoice = useCallback(
    (id: string) => {
      setTtsModel(id);
      setTtsVoice(defaultVoice(id) ?? '');
    },
    [],
  );

  // ── STT ─────────────────────────────────────────────────────────────────
  const [recordPhase, setRecordPhase] = useState<RecordPhase>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const advanceRecord = useCallback((event: Parameters<typeof nextRecordPhase>[1]) => {
    setRecordPhase((p) => nextRecordPhase(p, event));
  }, []);

  const toggleRecording = useCallback(async () => {
    if (recorderRef.current && recordPhase === 'recording') {
      recorderRef.current.stop();
      return;
    }
    if (!sttAvailable) return notify('Voice input is not configured');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return notify('Microphone unavailable');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = chooseRecorderMime((m) =>
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
      );
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        advanceRecord({ type: 'stop' }); // → transcribing
        try {
          const type = rec.mimeType || mime || 'audio/webm';
          const blob = new Blob(chunks, { type });
          const filename = audioFilename(type);
          const fd = new FormData();
          fd.append('file', blob, filename);
          fd.append('filename', filename);
          if (sttModel) fd.append('model', sttModel); // catalog pick; empty → gateway default
          const r = await fetch('/api/v1/chat/transcribe', { method: 'POST', body: fd });
          if (!r.ok) {
            advanceRecord({ type: 'fail' });
            notify(r.status === 503 ? 'Voice input is not configured' : 'Transcription unavailable');
            setTimeout(() => advanceRecord({ type: 'reset' }), 1500);
            return;
          }
          const { text } = (await r.json()) as { text?: string };
          onTranscript((existing) => mergeTranscript(existing, text ?? ''));
          advanceRecord({ type: 'result' });
        } catch {
          advanceRecord({ type: 'fail' });
          notify('Transcription failed');
          setTimeout(() => advanceRecord({ type: 'reset' }), 1500);
        }
      };
      recorderRef.current = rec;
      rec.start();
      advanceRecord({ type: 'start' });
    } catch (err) {
      // getUserMedia IS the browser mic-permission prompt. Distinguish the outcomes so the operator
      // knows whether to grant access (denied) vs plug in a device (none) rather than a dead-end.
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        notify('Microphone blocked — allow mic access for this site in your browser, then try again');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        notify('No microphone found — connect a mic and try again');
      } else {
        notify('Microphone unavailable');
      }
    }
  }, [recordPhase, sttAvailable, advanceRecord, notify, onTranscript, sttModel]);

  // ── TTS ─────────────────────────────────────────────────────────────────
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [speakPhase, setSpeakPhase] = useState<SpeakPhase>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const teardownPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (browserTts && typeof window !== 'undefined') window.speechSynthesis.cancel();
  }, [browserTts]);

  const stopSpeaking = useCallback(() => {
    teardownPlayback();
    setSpeakingId(null);
    setSpeakPhase('idle');
  }, [teardownPlayback]);

  useEffect(() => () => teardownPlayback(), [teardownPlayback]);

  const speak = useCallback(
    async (id: string, text: string) => {
      // Toggle on the SAME message: pause / resume / (from error) restart.
      if (speakingId === id) {
        if (speakPhase === 'playing') {
          if (audioRef.current) audioRef.current.pause();
          else if (browserTts) window.speechSynthesis.pause();
          setSpeakPhase((p) => nextSpeakPhase(p, { type: 'pause' }));
          return;
        }
        if (speakPhase === 'paused') {
          if (audioRef.current) void audioRef.current.play();
          else if (browserTts) window.speechSynthesis.resume();
          setSpeakPhase((p) => nextSpeakPhase(p, { type: 'resume' }));
          return;
        }
      }
      // New/other message: stop whatever's playing and start fresh.
      teardownPlayback();
      if (backend === 'none') return notify('Read aloud is not available');
      const clean = textForSpeech(text);
      if (!clean) return;
      setSpeakingId(id);
      setSpeakPhase('loading');

      // Server TTS first (on-prem model); fall back to the browser voice on any failure.
      if (backend === 'server') {
        try {
          const r = await fetch('/api/v1/chat/speak', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            // Catalog picks (empty → gateway default), fully backward-compatible.
            body: JSON.stringify({ input: clean, model: ttsModel || undefined, voice: ttsVoice || undefined }),
          });
          if (r.ok) {
            const url = URL.createObjectURL(await r.blob());
            objectUrlRef.current = url;
            const audio = new Audio(url);
            audioRef.current = audio;
            audio.onended = () => { stopSpeaking(); };
            await audio.play();
            setSpeakPhase((p) => nextSpeakPhase(p, { type: 'ready' }));
            return;
          }
          // 503/502 from server TTS → try the browser fallback if we have it.
          if (!browserTts) {
            setSpeakPhase('error');
            notify(r.status === 503 ? 'Read aloud is not configured' : 'Speech unavailable');
            setTimeout(() => stopSpeaking(), 1500);
            return;
          }
        } catch {
          if (!browserTts) {
            setSpeakPhase('error');
            notify('Speech failed');
            setTimeout(() => stopSpeaking(), 1500);
            return;
          }
        }
      }

      // Browser speechSynthesis fallback (local, offline).
      if (browserTts) {
        try {
          const u = new SpeechSynthesisUtterance(clean);
          u.onend = () => { stopSpeaking(); };
          u.onerror = () => { setSpeakPhase('error'); setTimeout(() => stopSpeaking(), 1500); };
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
          setSpeakPhase((p) => nextSpeakPhase(p, { type: 'ready' }));
          return;
        } catch {
          setSpeakPhase('error');
          notify('Speech failed');
          setTimeout(() => stopSpeaking(), 1500);
        }
      }
    },
    [speakingId, speakPhase, backend, browserTts, teardownPlayback, stopSpeaking, notify, ttsModel, ttsVoice],
  );

  const speakLabel = useCallback(
    (id: string) => speakButtonLabel(speakingId === id ? speakPhase : 'idle', backend),
    [speakingId, speakPhase, backend],
  );

  return {
    sttAvailable,
    ttsAvailable,
    recordPhase,
    recording: isCapturing(recordPhase),
    micLabel: recordButtonLabel(recordPhase, sttAvailable),
    toggleRecording,
    speakingId,
    speakPhase,
    speak,
    stopSpeaking,
    speakLabel,
    sttModels,
    ttsModels,
    sttModel,
    setSttModel,
    ttsModel,
    setTtsModel: setTtsModelAndVoice,
    ttsVoices,
    ttsVoice,
    setTtsVoice,
  };
}
