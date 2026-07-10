// @offgrid/speech — pure target resolution + MIME/filename mapping.
//
// ZERO-IO, ZERO-React, ZERO-fetch. Every function here is a deterministic rule so the client
// (client.ts) and the host app's route handlers stay dumb and the behavior is unit-testable.
//
// AIR-GAP CONTRACT: a speech modality resolves to an ON-PREM target only — a dedicated on-prem
// service (sttUrl / ttsUrl) if configured, else the on-prem gateway aggregator's OpenAI-style
// /v1/audio/* endpoints (transcription + speech). Nothing here can reach the internet. There is
// no cloud branch to resolve to; when neither a dedicated service nor a gateway is configured the
// modality reports `none` (unavailable) and the caller fails gracefully.
//
// APP-AGNOSTIC: the module takes no env of its own. The host app passes an `AudioEnv` (its
// resolved URLs) and, optionally, a `displayHost` mapper so the app controls how an internal
// address is rendered to the operator (the console maps loopback/IP → mDNS host; desktop may pass
// identity). Kept injectable so this one copy is shared by console + desktop.

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
// Config resolution — where do STT / TTS actually go, and is a modality usable at all?
//
// Resolved from the app-supplied env. A small honest view (`audioConfigView`) is handed to the UI
// so it can show "audio not configured" states without guessing.
// ─────────────────────────────────────────────────────────────────────────────

export interface AudioEnv {
  /** Dedicated on-prem STT service base URL. Empty/undefined → use the gateway. */
  sttUrl?: string;
  /** Dedicated on-prem TTS service base URL. Empty/undefined → use the gateway. */
  ttsUrl?: string;
  /** The on-prem gateway aggregator base. Its /v1/audio/* is the default target. */
  gatewayUrl?: string;
}

/** Which backend a modality resolves to. */
export type AudioBackend = 'dedicated' | 'gateway' | 'none';

export interface ModalityTarget {
  backend: AudioBackend;
  /** Absolute URL the client should POST to. '' when backend === 'none'. */
  url: string;
  /** Whether this modality is usable (dedicated or gateway present). */
  available: boolean;
  /** Host to SHOW the operator. Mapped by the app-supplied displayHost fn. '' when unavailable. */
  displayHost: string;
}

/**
 * Maps an internal base URL to the host string shown to the operator. The host app injects this so
 * it controls display policy (the console maps loopback/private IP → mDNS host so no raw IP leaks).
 * Defaults to identity when the app doesn't care.
 */
export type DisplayHostFn = (url: string) => string;

const identityHost: DisplayHostFn = (u) => u;

function trimUrl(u: string | undefined): string {
  return (u ?? '').trim().replace(/\/+$/, '');
}

function resolve(
  dedicatedRaw: string | undefined,
  gatewayRaw: string | undefined,
  audioPath: string,
  displayHost: DisplayHostFn,
): ModalityTarget {
  const dedicated = trimUrl(dedicatedRaw);
  if (dedicated) {
    return { backend: 'dedicated', url: `${dedicated}${audioPath}`, available: true, displayHost: displayHost(dedicated) };
  }
  const gw = trimUrl(gatewayRaw);
  if (gw) {
    return { backend: 'gateway', url: `${gw}${audioPath}`, available: true, displayHost: displayHost(gw) };
  }
  return { backend: 'none', url: '', available: false, displayHost: '' };
}

/**
 * Resolve the STT target: a dedicated service if configured, else the gateway's
 * /v1/audio/transcriptions, else none. Pure.
 */
export function resolveSttTarget(env: AudioEnv, displayHost: DisplayHostFn = identityHost): ModalityTarget {
  return resolve(env.sttUrl, env.gatewayUrl, '/v1/audio/transcriptions', displayHost);
}

/**
 * Resolve the TTS target: a dedicated service if configured, else the gateway's /v1/audio/speech,
 * else none. Pure. Server TTS being 'none' is NOT fatal — the host may offer a fully-local browser
 * speechSynthesis fallback (also air-gap-safe), decided by `speakBackend`.
 */
export function resolveTtsTarget(env: AudioEnv, displayHost: DisplayHostFn = identityHost): ModalityTarget {
  return resolve(env.ttsUrl, env.gatewayUrl, '/v1/audio/speech', displayHost);
}

/** Honest config view handed to the client so it renders the right enabled/disabled + tooltip. */
export interface AudioConfigView {
  stt: { available: boolean; backend: AudioBackend; displayHost: string };
  /** TTS: serverAvailable=false still allows the browser fallback (browserFallback always true). */
  tts: { serverAvailable: boolean; backend: AudioBackend; displayHost: string; browserFallback: true };
}

/** Build the client-facing config view from env. Pure. */
export function audioConfigView(env: AudioEnv, displayHost: DisplayHostFn = identityHost): AudioConfigView {
  const stt = resolveSttTarget(env, displayHost);
  const tts = resolveTtsTarget(env, displayHost);
  return {
    stt: { available: stt.available, backend: stt.backend, displayHost: stt.displayHost },
    tts: { serverAvailable: tts.available, backend: tts.backend, displayHost: tts.displayHost, browserFallback: true },
  };
}
