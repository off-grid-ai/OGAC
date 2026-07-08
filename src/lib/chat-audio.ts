// Pure logic for chat audio mode — STT (voice input) + TTS (read answers aloud).
// ZERO IO, ZERO React, ZERO fetch — every function here is a deterministic rule, so the hook +
// route handlers stay dumb and the behavior is unit-testable. All network work lives in the
// route handlers (server) and the browser APIs (client); this module only DECIDES.
//
// DRY: the air-gap target resolution, the MIME→filename map, and the honest config view now live
// ONCE in the shared, engine-agnostic `@offgrid/speech` package (used by the console + later the
// desktop). This module re-exports them BOUND to the console's display policy (`toDisplayHost` —
// mDNS host, never a raw IP / loopback, per the founder directive) and keeps the console-only bits:
// the two UI state machines (record / speak) and the composer text/level shaping.
//
// AIR-GAP CONTRACT (enforced in the package): STT/TTS resolve to on-prem targets only — a dedicated
// on-prem service (OFFGRID_STT_URL / OFFGRID_TTS_URL) if configured, else the on-prem gateway
// aggregator's OpenAI-style /v1/audio/* endpoints. TTS additionally has a fully-local browser
// fallback (speechSynthesis). Nothing here can reach the internet.

import {
  type AudioEnv,
  type ModalityTarget,
  type AudioConfigView,
  resolveSttTarget as resolveSttTargetPkg,
  resolveTtsTarget as resolveTtsTargetPkg,
  audioConfigView as audioConfigViewPkg,
} from '@offgrid/speech';
import { toDisplayHost } from './display-host';

// Re-export the shared MIME helpers + types verbatim so existing imports of `@/lib/chat-audio`
// keep working unchanged (behavior-preserving consolidation).
export {
  RECORDER_MIME_PREFERENCE,
  chooseRecorderMime,
  audioFilename,
} from '@offgrid/speech';
export type { AudioEnv, AudioBackend, ModalityTarget, AudioConfigView } from '@offgrid/speech';

// ─────────────────────────────────────────────────────────────────────────────
// Target resolution — console-bound to the mDNS display policy.
//
// The DECISION (dedicated → gateway → none + the /v1/audio/* path) is the shared package rule; we
// inject `toDisplayHost` so the operator only ever sees an mDNS host (offgrid-s1.local, …), never a
// raw IP / loopback. Same signatures + behavior as before the extraction.
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve the STT target (dedicated → gateway → none), display host mapped to mDNS. */
export function resolveSttTarget(env: AudioEnv): ModalityTarget {
  return resolveSttTargetPkg(env, toDisplayHost);
}

/** Resolve the TTS target (dedicated → gateway → none), display host mapped to mDNS. */
export function resolveTtsTarget(env: AudioEnv): ModalityTarget {
  return resolveTtsTargetPkg(env, toDisplayHost);
}

/** Build the client-facing config view from env, display hosts mapped to mDNS. */
export function audioConfigView(env: AudioEnv): AudioConfigView {
  return audioConfigViewPkg(env, toDisplayHost);
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
