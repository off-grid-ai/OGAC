// @offgrid/speech — the I/O seam: transcribe (STT) + speak (TTS) against a resolved target.
//
// The DECISIONS (which backend, which URL, availability) are the pure functions in targets.ts;
// this module only does the network. Keeping fetch here keeps the host app's route handlers thin
// and the resolution unit-tested.
//
// ENGINE-AGNOSTIC: the client just POSTs to the OpenAI-compatible /v1/audio/* endpoints. Which
// model actually serves the request is gateway config; the caller may pass a `model` (+ `voice`
// for TTS) from the catalog, and the gateway routes it.
//
// NO THROW: every network/upstream error is caught and mapped to a discriminated failure
// (`not-configured` when nothing is wired, `unavailable` when the wired target failed). The client
// never reaches the internet — targets resolve to on-prem hosts only (see targets.ts air-gap note).
//
// AUTH: injected. The caller passes an `authHeaders(target)` fn so the app owns credentials (the
// console injects its gateway bearer/x-api-key only for the gateway backend; a dedicated on-prem
// service typically carries none). The client never holds a secret itself.

import {
  type AudioEnv,
  type DisplayHostFn,
  type ModalityTarget,
  resolveSttTarget,
  resolveTtsTarget,
} from './targets.js';

/** Failure reasons shared by both modalities. */
export type SpeechFailure = { ok: false; reason: 'not-configured' | 'unavailable' };

export type TranscribeResult = { ok: true; text: string } | SpeechFailure;

export type SpeakResult =
  | { ok: true; body: ReadableStream<Uint8Array>; contentType: string }
  | SpeechFailure;

/**
 * Injects auth headers for a resolved target. Return the headers to merge onto the request. The
 * `extra` (e.g. content-type) is passed so the app can merge in one place. Default: no auth.
 */
export type AuthHeadersFn = (
  target: ModalityTarget,
  extra?: Record<string, string>,
) => Record<string, string>;

const noAuth: AuthHeadersFn = (_t, extra = {}) => extra;

export interface SpeechClientOptions {
  /** App-resolved on-prem URLs (dedicated STT/TTS + gateway). */
  env: AudioEnv;
  /** Auth-header injector (app owns credentials). Default: none. */
  authHeaders?: AuthHeadersFn;
  /** Display-host mapper for `target.displayHost` (app display policy). Default: identity. */
  displayHost?: DisplayHostFn;
  /** Upstream timeout in ms. Default 110s (under a typical 120s route budget). */
  timeoutMs?: number;
  /** fetch impl (injectable for tests / non-browser). Default: global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 110_000;
const MAX_TTS_INPUT = 4000;

/**
 * Create a speech client bound to an app's env + auth. Both methods are no-throw and return a
 * discriminated result. This is the ONE copy of the audio I/O shared by the console (+ desktop).
 */
export function createSpeechClient(options: SpeechClientOptions) {
  const {
    env,
    authHeaders = noAuth,
    displayHost,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl,
  } = options;
  const doFetch: typeof fetch = fetchImpl ?? (globalThis.fetch as typeof fetch);

  /**
   * Forward recorded audio to the resolved on-prem STT target. `opts.model` selects a catalog STT
   * engine (optional; gateway config decides otherwise). Returns the transcript text, or a
   * discriminated failure. No throw — network errors become `unavailable`.
   */
  async function transcribe(
    audio: Blob,
    opts: { filename: string; model?: string } = { filename: 'audio.webm' },
  ): Promise<TranscribeResult> {
    const target = resolveSttTarget(env, displayHost);
    if (!target.available) return { ok: false, reason: 'not-configured' };
    const body = new FormData();
    body.append('file', audio, opts.filename);
    if (opts.model) body.append('model', opts.model);
    const r = await doFetch(target.url, {
      method: 'POST',
      headers: authHeaders(target),
      body,
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => null);
    if (!r || !r.ok) return { ok: false, reason: 'unavailable' };
    const j = (await r.json().catch(() => ({}))) as { text?: string };
    return { ok: true, text: typeof j?.text === 'string' ? j.text : '' };
  }

  /**
   * Forward text to the resolved on-prem TTS target and return the audio stream + content type, or
   * a discriminated failure. `opts.model` / `opts.voice` select a catalog TTS engine + voice
   * (optional). No throw. Server TTS unavailable → `not-configured` (the app then uses a local
   * browser speechSynthesis fallback, decided app-side).
   */
  async function speak(
    text: string,
    opts: { voice?: string; model?: string } = {},
  ): Promise<SpeakResult> {
    const target = resolveTtsTarget(env, displayHost);
    if (!target.available) return { ok: false, reason: 'not-configured' };
    const payload: Record<string, unknown> = {
      model: opts.model ?? 'tts',
      input: text.slice(0, MAX_TTS_INPUT),
      voice: opts.voice ?? 'alloy',
    };
    const r = await doFetch(target.url, {
      method: 'POST',
      headers: authHeaders(target, { 'content-type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => null);
    if (!r || !r.ok || !r.body) return { ok: false, reason: 'unavailable' };
    return {
      ok: true,
      body: r.body as ReadableStream<Uint8Array>,
      contentType: r.headers.get('content-type') ?? 'audio/mpeg',
    };
  }

  return { transcribe, speak };
}

export type SpeechClient = ReturnType<typeof createSpeechClient>;
