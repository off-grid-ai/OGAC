// Server-side audio adapter — the I/O seam for STT/TTS. The DECISIONS (which backend, which URL,
// availability) are the pure functions in `chat-audio.ts`; this module only reads env and does the
// network. Keeping the fetch here keeps the route handlers thin and the resolution unit-tested.
//
// AIR-GAP: every target resolves to an on-prem host (dedicated OFFGRID_STT_URL/OFFGRID_TTS_URL, or
// the on-prem gateway aggregator). There is NO cloud fallback path — if nothing is configured the
// modality reports unavailable and the route returns a graceful 503, never reaching the internet.

import {
  type AudioEnv,
  type ModalityTarget,
  audioConfigView,
  type AudioConfigView,
  resolveSttTarget,
  resolveTtsTarget,
} from './chat-audio';
import { GATEWAY_URL, gatewayHeaders } from './gateway';

/** Read audio env once. Dedicated STT/TTS services are optional; the gateway is the default. */
export function audioEnv(): AudioEnv {
  return {
    sttUrl: process.env.OFFGRID_STT_URL,
    ttsUrl: process.env.OFFGRID_TTS_URL,
    gatewayUrl: process.env.OFFGRID_GATEWAY_URL ?? GATEWAY_URL,
  };
}

/** The honest config view the client uses to enable/disable + label the audio controls. */
export function resolveAudioConfig(): AudioConfigView {
  return audioConfigView(audioEnv());
}

/** Whether a target is on the shared gateway (so it needs the gateway auth headers). */
function authHeadersFor(target: ModalityTarget, extra: Record<string, string> = {}): Record<string, string> {
  // Dedicated on-prem STT/TTS services carry no gateway key; only the gateway path is authed.
  // A dedicated service that needs auth can be fronted by Caddy on the LAN — out of scope here.
  return target.backend === 'gateway' ? gatewayHeaders(extra) : extra;
}

const UPSTREAM_TIMEOUT_MS = 110_000;

/**
 * Forward recorded audio to the resolved on-prem STT target. Returns the transcript text, or a
 * discriminated failure the route maps to a status. No throw — network errors become `unavailable`.
 */
export async function transcribeAudio(
  file: Blob,
  filename: string,
): Promise<{ ok: true; text: string } | { ok: false; reason: 'not-configured' | 'unavailable' }> {
  const target = resolveSttTarget(audioEnv());
  if (!target.available) return { ok: false, reason: 'not-configured' };
  const body = new FormData();
  body.append('file', file, filename);
  const r = await fetch(target.url, {
    method: 'POST',
    headers: authHeadersFor(target),
    body,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  }).catch(() => null);
  if (!r || !r.ok) return { ok: false, reason: 'unavailable' };
  const j = (await r.json().catch(() => ({}))) as { text?: string };
  return { ok: true, text: typeof j?.text === 'string' ? j.text : '' };
}

/**
 * Forward text to the resolved on-prem TTS target and return the audio stream + content type, or a
 * discriminated failure. No throw. Server TTS unavailable → `not-configured` (the client then uses
 * the local browser speechSynthesis fallback — decided client-side).
 */
export async function synthesizeSpeech(
  input: string,
  voice = 'alloy',
): Promise<
  | { ok: true; body: ReadableStream<Uint8Array>; contentType: string }
  | { ok: false; reason: 'not-configured' | 'unavailable' }
> {
  const target = resolveTtsTarget(audioEnv());
  if (!target.available) return { ok: false, reason: 'not-configured' };
  const r = await fetch(target.url, {
    method: 'POST',
    headers: authHeadersFor(target, { 'content-type': 'application/json' }),
    body: JSON.stringify({ model: 'tts', input: input.slice(0, 4000), voice }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  }).catch(() => null);
  if (!r || !r.ok || !r.body) return { ok: false, reason: 'unavailable' };
  return { ok: true, body: r.body, contentType: r.headers.get('content-type') ?? 'audio/mpeg' };
}
