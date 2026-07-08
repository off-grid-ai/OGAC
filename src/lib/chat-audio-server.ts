// Server-side audio adapter — the console's env-wiring + auth glue over the shared @offgrid/speech
// client. The DECISIONS (which backend, which URL, availability) and the I/O (transcribe/speak) now
// live ONCE in the package; this module only reads the console's env, injects the gateway auth
// headers, and exposes the selectable speech-model catalog to the client.
//
// AIR-GAP: every target resolves to an on-prem host (dedicated OFFGRID_STT_URL/OFFGRID_TTS_URL, or
// the on-prem gateway aggregator). There is NO cloud fallback path — if nothing is configured the
// modality reports unavailable and the route returns a graceful 503/502, never reaching the internet.

import {
  type AudioEnv,
  type ModalityTarget,
  type AudioConfigView,
  type SpeechModel,
  audioConfigView,
  createSpeechClient,
  listSpeechModels,
  defaultStt,
  defaultTts,
  defaultVoice,
} from '@offgrid/speech';
import { toDisplayHost } from './display-host';
import { GATEWAY_URL, gatewayHeaders } from './gateway';

/** Read audio env once. Dedicated STT/TTS services are optional; the gateway is the default. */
export function audioEnv(): AudioEnv {
  return {
    sttUrl: process.env.OFFGRID_STT_URL,
    ttsUrl: process.env.OFFGRID_TTS_URL,
    gatewayUrl: process.env.OFFGRID_GATEWAY_URL ?? GATEWAY_URL,
  };
}

/** Inject auth only for the gateway backend (dedicated on-prem services carry no gateway key). */
function authHeadersFor(target: ModalityTarget, extra: Record<string, string> = {}): Record<string, string> {
  return target.backend === 'gateway' ? gatewayHeaders(extra) : extra;
}

/** The console's speech client — env-bound, gateway-authed, mDNS display policy. */
function client() {
  return createSpeechClient({
    env: audioEnv(),
    authHeaders: authHeadersFor,
    displayHost: toDisplayHost,
  });
}

/**
 * The honest audio-config view the client uses to enable/disable + label the audio controls, plus
 * the selectable speech-model catalog (engine + voice picker). A model listed here is OFFERED; the
 * gateway decides which is actually live, and a model it can't serve degrades to the default (the
 * client falls back gracefully — see useChatAudio). No OSS-engine names leak in the labels.
 */
export interface AudioConfigWithModels extends AudioConfigView {
  models: {
    stt: SpeechModel[];
    tts: SpeechModel[];
    defaultStt: string;
    defaultTts: string;
    /** Default voice for the default TTS model (or null for a voiceless model). */
    defaultVoice: string | null;
  };
}

/** Build the client-facing config (availability + catalog). Pure over env. */
export function resolveAudioConfig(): AudioConfigWithModels {
  const view = audioConfigView(audioEnv(), toDisplayHost);
  return {
    ...view,
    models: {
      stt: [...listSpeechModels('stt')],
      tts: [...listSpeechModels('tts')],
      defaultStt,
      defaultTts,
      defaultVoice: defaultVoice(defaultTts) ?? null,
    },
  };
}

/**
 * Forward recorded audio to the resolved on-prem STT target. `model` optionally selects a catalog
 * STT engine. Returns the transcript, or a discriminated failure the route maps to a status. No
 * throw — network errors become `unavailable`.
 */
export async function transcribeAudio(
  file: Blob,
  filename: string,
  model?: string,
): Promise<{ ok: true; text: string } | { ok: false; reason: 'not-configured' | 'unavailable' }> {
  return client().transcribe(file, { filename, model });
}

/**
 * Forward text to the resolved on-prem TTS target and return the audio stream + content type, or a
 * discriminated failure. `model`/`voice` optionally select a catalog TTS engine + voice. No throw.
 * Server TTS unavailable → `not-configured` (the client then uses the local browser fallback).
 */
export async function synthesizeSpeech(
  input: string,
  voice = 'alloy',
  model?: string,
): Promise<
  | { ok: true; body: ReadableStream<Uint8Array>; contentType: string }
  | { ok: false; reason: 'not-configured' | 'unavailable' }
> {
  return client().speak(input, { voice, model });
}
