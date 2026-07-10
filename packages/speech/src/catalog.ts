// @offgrid/speech — speech-model catalog.
//
// Static, engine-agnostic DATA describing the STT + TTS models the on-prem gateway can be
// configured to serve. This lets an app render an engine/voice PICKER without hardcoding a single
// model: the catalog is the menu, and the live gateway config decides which entries are actually
// serveable (a model not live on the gateway simply isn't selectable / degrades to the default).
//
// HONESTY: `label` and `notes` are what an operator SEES — they describe the model by its user-
// facing characteristics (natural/fast/light/accurate), never leaking an OSS-internal engine name.
// `id` is the technical model id passed to the gateway (that CAN be technical), and `engine` is an
// internal field for our own diagnostics — apps must not surface `engine` verbatim in user copy.

export type SpeechKind = 'stt' | 'tts';

export interface SpeechVoice {
  /** Voice id sent to the TTS endpoint. */
  id: string;
  /** Operator-facing voice name. */
  label: string;
}

export interface SpeechModel {
  /** Technical model id passed to the gateway's /v1/audio/* `model` field. May be technical. */
  id: string;
  kind: SpeechKind;
  /** Operator-facing name (no OSS-internal engine leak). */
  label: string;
  /** INTERNAL engine tag for our diagnostics — do NOT render verbatim in user-facing copy. */
  engine: string;
  /** Operator-facing one-liner describing the trade-off (quality/speed/size). */
  notes: string;
  /** Available voices (TTS only). Omitted/empty for STT. */
  voices?: readonly SpeechVoice[];
}

// STT — speech-to-text. Keep BOTH; the gateway picks which is live.
const STT_MODELS: readonly SpeechModel[] = [
  {
    id: 'parakeet',
    kind: 'stt',
    label: 'Fast transcription',
    engine: 'nvidia-parakeet-tdt',
    notes: 'Fastest, high-accuracy dictation. Best default for voice input.',
  },
  {
    id: 'whisper',
    kind: 'stt',
    label: 'Accurate transcription',
    engine: 'whisper.cpp',
    notes: 'Broad language coverage and robust on noisy audio; a little slower.',
  },
] as const;

// TTS — text-to-speech. Keep BOTH; the gateway picks which is live.
const TTS_MODELS: readonly SpeechModel[] = [
  {
    id: 'orpheus',
    kind: 'tts',
    label: 'Natural voice',
    engine: 'orpheus-gguf',
    notes: 'Most natural, expressive read-aloud. Best default when available.',
    voices: [
      { id: 'tara', label: 'Tara' },
      { id: 'leah', label: 'Leah' },
      { id: 'leo', label: 'Leo' },
      { id: 'dan', label: 'Dan' },
      { id: 'mia', label: 'Mia' },
      { id: 'zac', label: 'Zac' },
    ],
  },
  {
    id: 'kokoro',
    kind: 'tts',
    label: 'Light voice',
    engine: 'kokoro-82m',
    notes: 'Small, fast, low-resource voice. Reliable fallback on lighter hardware.',
    voices: [
      { id: 'af_heart', label: 'Heart' },
      { id: 'af_bella', label: 'Bella' },
      { id: 'am_michael', label: 'Michael' },
      { id: 'bf_emma', label: 'Emma' },
      { id: 'bm_george', label: 'George' },
    ],
  },
] as const;

/** The full catalog — STT then TTS. */
export const SPEECH_MODELS: readonly SpeechModel[] = [...STT_MODELS, ...TTS_MODELS] as const;

/** Default STT model id (preferred when the gateway serves it). */
export const defaultStt = 'parakeet';
/** Default TTS model id (preferred when the gateway serves it). */
export const defaultTts = 'orpheus';

/** List the catalog models for one modality (stt|tts). Pure. */
export function listSpeechModels(kind: SpeechKind): readonly SpeechModel[] {
  return SPEECH_MODELS.filter((m) => m.kind === kind);
}

/** Look up a model by id (any kind). Pure. */
export function getSpeechModel(id: string): SpeechModel | undefined {
  return SPEECH_MODELS.find((m) => m.id === id);
}

/** The default voice id for a TTS model (its first voice), or undefined for STT / no voices. */
export function defaultVoice(modelId: string): string | undefined {
  const m = getSpeechModel(modelId);
  return m?.voices && m.voices.length > 0 ? m.voices[0].id : undefined;
}
