// Pure logic for chat audio mode — STT (voice input) + TTS (read answers aloud).
// ZERO IO, ZERO React, ZERO fetch — every function here is a deterministic rule, so the hook +
// route handlers stay dumb and the behavior is unit-testable. All network work lives in the
// route handlers (server) and the browser APIs (client); this module only DECIDES.
//
// AIR-GAP CONTRACT: the console never speaks to a cloud API. STT/TTS resolve to on-prem targets
// only — a dedicated on-prem service (OFFGRID_STT_URL / OFFGRID_TTS_URL) if configured, else the
// on-prem gateway aggregator's OpenAI-style /v1/audio/* endpoints (transcription + speech are live
// modalities — see SERVICE_MAP.md). TTS additionally has a fully-local browser fallback
// (speechSynthesis) that needs no server at all. Nothing in here can reach the internet.

import { toDisplayHost } from './display-host';

// ─────────────────────────────────────────────────────────────────────────────
// MIME / container handling for MediaRecorder.
//
// Browsers disagree on what MediaRecorder can emit. We pick the first supported type from a
// preference list (webm/opus is the widest), and map it to a filename the STT backend accepts.
// ─────────────────────────────────────────────────────────────────────────────

/** Preference order for the recorder container. webm/opus first (Chrome/Firefox), then plain
 *  webm/ogg, then mp4/mpeg (Safari). The empty string result is the universal "let the UA decide". */
export const RECORDER_MIME_PREFERENCE: readonly string[] = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
];

/**
 * Choose a recorder MIME type given a support predicate (MediaRecorder.isTypeSupported). Pure:
 * the predicate is injected so this is testable without a browser. Returns '' when none of the
 * preferred types are supported — the caller then constructs MediaRecorder with no options and
 * lets the UA choose (still valid).
 */
export function chooseRecorderMime(isSupported: (mime: string) => boolean): string {
  for (const mime of RECORDER_MIME_PREFERENCE) {
    if (isSupported(mime)) return mime;
  }
  return '';
}

/** Map a recorder MIME type to an upload filename with the right extension. The STT backend keys
 *  off the extension, so this must track the container we actually recorded. */
export function audioFilename(mime: string): string {
  const base = (mime || '').split(';')[0].trim().toLowerCase();
  const ext =
    base === 'audio/mp4' ? 'mp4'
    : base === 'audio/mpeg' ? 'mp3'
    : base === 'audio/ogg' ? 'ogg'
    : 'webm';
  return `audio.${ext}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config resolution — where do STT / TTS actually go, and is audio usable at all?
//
// Resolved on the SERVER from env, then a small honest view is handed to the UI so it can show
// "audio not configured" states without ever guessing. The UI shows the mDNS display host
// (never a raw IP / loopback — founder directive), so config uses toDisplayHost.
// ─────────────────────────────────────────────────────────────────────────────

export interface AudioEnv {
  /** Dedicated on-prem STT service base URL (OFFGRID_STT_URL). Empty/undefined → use gateway. */
  sttUrl?: string;
  /** Dedicated on-prem TTS service base URL (OFFGRID_TTS_URL). Empty/undefined → use gateway. */
  ttsUrl?: string;
  /** The on-prem gateway aggregator base (OFFGRID_GATEWAY_URL). Its /v1/audio/* is the default. */
  gatewayUrl?: string;
}

/** Which backend a modality resolves to. */
export type AudioBackend = 'dedicated' | 'gateway' | 'none';

export interface ModalityTarget {
  backend: AudioBackend;
  /** Absolute URL the route should POST to. '' when backend === 'none'. */
  url: string;
  /** Whether this modality is usable server-side (dedicated or gateway present). */
  available: boolean;
  /** mDNS host to SHOW the operator (never a raw IP / loopback). '' when unavailable. */
  displayHost: string;
}

function trimUrl(u: string | undefined): string {
  return (u ?? '').trim().replace(/\/+$/, '');
}

/**
 * Resolve the STT target: a dedicated service if configured, else the gateway's
 * /v1/audio/transcriptions, else none. Pure.
 */
export function resolveSttTarget(env: AudioEnv): ModalityTarget {
  const dedicated = trimUrl(env.sttUrl);
  if (dedicated) {
    return { backend: 'dedicated', url: `${dedicated}/v1/audio/transcriptions`, available: true, displayHost: toDisplayHost(dedicated) };
  }
  const gw = trimUrl(env.gatewayUrl);
  if (gw) {
    return { backend: 'gateway', url: `${gw}/v1/audio/transcriptions`, available: true, displayHost: toDisplayHost(gw) };
  }
  return { backend: 'none', url: '', available: false, displayHost: '' };
}

/**
 * Resolve the TTS target: a dedicated service if configured, else the gateway's /v1/audio/speech,
 * else none. Pure. Server TTS being 'none' is NOT fatal — the client falls back to the local
 * browser speechSynthesis (also air-gap-safe), decided by speakBackend below.
 */
export function resolveTtsTarget(env: AudioEnv): ModalityTarget {
  const dedicated = trimUrl(env.ttsUrl);
  if (dedicated) {
    return { backend: 'dedicated', url: `${dedicated}/v1/audio/speech`, available: true, displayHost: toDisplayHost(dedicated) };
  }
  const gw = trimUrl(env.gatewayUrl);
  if (gw) {
    return { backend: 'gateway', url: `${gw}/v1/audio/speech`, available: true, displayHost: toDisplayHost(gw) };
  }
  return { backend: 'none', url: '', available: false, displayHost: '' };
}

/** Honest config view handed to the client so it renders the right enabled/disabled + tooltip. */
export interface AudioConfigView {
  stt: { available: boolean; backend: AudioBackend; displayHost: string };
  /** TTS: serverAvailable=false still allows the browser fallback (browserFallback always true). */
  tts: { serverAvailable: boolean; backend: AudioBackend; displayHost: string; browserFallback: true };
}

/** Build the client-facing config view from env. Pure. */
export function audioConfigView(env: AudioEnv): AudioConfigView {
  const stt = resolveSttTarget(env);
  const tts = resolveTtsTarget(env);
  return {
    stt: { available: stt.available, backend: stt.backend, displayHost: stt.displayHost },
    tts: { serverAvailable: tts.available, backend: tts.backend, displayHost: tts.displayHost, browserFallback: true },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STT recording state machine.
//
//   idle → recording → transcribing → idle
//   any → error (recoverable back to idle)
// The hook drives transitions; these rules keep the button label/behavior consistent + tested.
// ─────────────────────────────────────────────────────────────────────────────

export type RecordPhase = 'idle' | 'recording' | 'transcribing' | 'error';

export type RecordEvent =
  | { type: 'start' }
  | { type: 'stop' } // recording finished, upload begins
  | { type: 'result' } // transcript returned
  | { type: 'fail' }
  | { type: 'reset' };

/** Advance the record phase. Pure reducer — invalid transitions are no-ops (return current). */
export function nextRecordPhase(phase: RecordPhase, event: RecordEvent): RecordPhase {
  switch (event.type) {
    case 'start':
      return phase === 'idle' || phase === 'error' ? 'recording' : phase;
    case 'stop':
      return phase === 'recording' ? 'transcribing' : phase;
    case 'result':
      return phase === 'transcribing' ? 'idle' : phase;
    case 'fail':
      return 'error';
    case 'reset':
      return 'idle';
  }
}

/** True while the mic is actively capturing — drives the pulsing/level UI. */
export function isCapturing(phase: RecordPhase): boolean {
  return phase === 'recording';
}

/** Button tooltip/label for the current record phase + availability. */
export function recordButtonLabel(phase: RecordPhase, sttAvailable: boolean): string {
  if (!sttAvailable) return 'Voice input not configured';
  switch (phase) {
    case 'recording':
      return 'Stop recording';
    case 'transcribing':
      return 'Transcribing…';
    case 'error':
      return 'Voice input failed — try again';
    case 'idle':
      return 'Dictate';
  }
}

/**
 * Merge a fresh transcript into the existing composer text. Pure. Appends with a single space,
 * trims, and no-ops on empty transcript (so a failed/empty STT never clobbers the composer).
 */
export function mergeTranscript(existing: string, transcript: string): string {
  const t = (transcript ?? '').trim();
  if (!t) return existing;
  const base = (existing ?? '').trim();
  return base ? `${base} ${t}` : t;
}

/**
 * Normalise a raw mic RMS/level (any finite number, any scale via `max`) to a 0..1 bar value.
 * Clamps and guards NaN/negatives so the level meter never renders garbage. Pure.
 */
export function normalizeLevel(raw: number, max = 128): number {
  if (!Number.isFinite(raw) || raw <= 0 || max <= 0) return 0;
  const v = raw / max;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ─────────────────────────────────────────────────────────────────────────────
// TTS playback state machine + backend selection.
//
//   idle → loading → playing ⇄ paused → idle
//   any → error (back to idle on reset)
// Backend: prefer server TTS (higher quality, on-prem model) when available; else the local
// browser speechSynthesis fallback (offline, in-browser — still air-gap-safe). Both are decided
// here so the play button behaves identically regardless of which path is taken.
// ─────────────────────────────────────────────────────────────────────────────

export type SpeakPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export type SpeakEvent =
  | { type: 'request' } // user clicked play; begin fetching/synthesizing
  | { type: 'ready' } // audio ready and started
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'ended' } // playback finished
  | { type: 'stop' }
  | { type: 'fail' }
  | { type: 'reset' };

/** Advance the speak phase. Pure reducer — invalid transitions are no-ops. */
export function nextSpeakPhase(phase: SpeakPhase, event: SpeakEvent): SpeakPhase {
  switch (event.type) {
    case 'request':
      return phase === 'idle' || phase === 'error' ? 'loading' : phase;
    case 'ready':
      return phase === 'loading' ? 'playing' : phase;
    case 'pause':
      return phase === 'playing' ? 'paused' : phase;
    case 'resume':
      return phase === 'paused' ? 'playing' : phase;
    case 'ended':
    case 'stop':
      return 'idle';
    case 'fail':
      return 'error';
    case 'reset':
      return 'idle';
  }
}

export type SpeakBackend = 'server' | 'browser' | 'none';

/**
 * Decide how a play request is fulfilled. Pure.
 *   - server TTS configured → 'server' (fetch audio from the on-prem route)
 *   - else browser speechSynthesis available → 'browser' (local, offline)
 *   - else 'none' (nothing can speak — button disabled)
 */
export function speakBackend(serverTtsAvailable: boolean, browserSpeechAvailable: boolean): SpeakBackend {
  if (serverTtsAvailable) return 'server';
  if (browserSpeechAvailable) return 'browser';
  return 'none';
}

/** Whether a play button is actionable at all (some backend can speak). */
export function canSpeak(serverTtsAvailable: boolean, browserSpeechAvailable: boolean): boolean {
  return speakBackend(serverTtsAvailable, browserSpeechAvailable) !== 'none';
}

/** Play-button tooltip for the current phase + backend availability. */
export function speakButtonLabel(phase: SpeakPhase, backend: SpeakBackend): string {
  if (backend === 'none') return 'Read aloud not available';
  switch (phase) {
    case 'loading':
      return 'Preparing audio…';
    case 'playing':
      return 'Pause';
    case 'paused':
      return 'Resume';
    case 'error':
      return 'Playback failed — try again';
    case 'idle':
      return backend === 'browser' ? 'Read aloud (browser voice)' : 'Read aloud';
  }
}

/**
 * Strip markdown/citation noise so TTS reads clean prose, not syntax. Pure. Removes code fences,
 * inline-citation chips like [1], link/image syntax, heading/emphasis markers, and collapses
 * whitespace. Also caps length so a huge answer doesn't blow the TTS request/synth budget.
 */
export function textForSpeech(markdown: string, maxLen = 4000): string {
  let t = markdown ?? '';
  t = t.replace(/```[\s\S]*?```/g, ' '); // fenced code blocks
  t = t.replace(/`([^`]+)`/g, '$1'); // inline code
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1'); // images/links → their text
  t = t.replace(/\[\d+\]/g, ' '); // citation chips [1]
  t = t.replace(/^#{1,6}\s+/gm, ''); // headings
  t = t.replace(/[*_~>]/g, ''); // emphasis / blockquote markers
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}
