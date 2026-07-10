// @offgrid/speech — public entry
//
// Engine-agnostic speech client for the Off Grid AI local gateway. Two halves:
//   - PURE (targets.ts): air-gap target resolution (dedicated → gateway → none), MIME/filename
//     mapping, and the honest config view. Zero-IO, unit-tested, shared by console + desktop.
//   - I/O (client.ts): an OpenAI-compatible /v1/audio/* client (transcribe + speak) that never
//     throws and never leaves the on-prem network; auth is injected by the host app.
// Plus a selectable, engine-agnostic speech-model CATALOG (catalog.ts) an app renders as a picker.

export {
  RECORDER_MIME_PREFERENCE,
  chooseRecorderMime,
  audioFilename,
  resolveSttTarget,
  resolveTtsTarget,
  audioConfigView,
  type AudioEnv,
  type AudioBackend,
  type ModalityTarget,
  type AudioConfigView,
  type DisplayHostFn,
} from './targets.js';

export {
  createSpeechClient,
  type SpeechClient,
  type SpeechClientOptions,
  type AuthHeadersFn,
  type SpeechFailure,
  type TranscribeResult,
  type SpeakResult,
} from './client.js';

export {
  SPEECH_MODELS,
  defaultStt,
  defaultTts,
  listSpeechModels,
  getSpeechModel,
  defaultVoice,
  type SpeechKind,
  type SpeechModel,
  type SpeechVoice,
} from './catalog.js';
