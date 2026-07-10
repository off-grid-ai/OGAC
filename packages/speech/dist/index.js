// src/targets.ts
var RECORDER_MIME_PREFERENCE = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/mpeg"
];
function chooseRecorderMime(isSupported) {
  for (const mime of RECORDER_MIME_PREFERENCE) {
    if (isSupported(mime)) return mime;
  }
  return "";
}
function audioFilename(mime) {
  const base = (mime || "").split(";")[0].trim().toLowerCase();
  const ext = base === "audio/mp4" ? "mp4" : base === "audio/mpeg" ? "mp3" : base === "audio/ogg" ? "ogg" : "webm";
  return `audio.${ext}`;
}
var identityHost = (u) => u;
function trimUrl(u) {
  return (u ?? "").trim().replace(/\/+$/, "");
}
function resolve(dedicatedRaw, gatewayRaw, audioPath, displayHost) {
  const dedicated = trimUrl(dedicatedRaw);
  if (dedicated) {
    return { backend: "dedicated", url: `${dedicated}${audioPath}`, available: true, displayHost: displayHost(dedicated) };
  }
  const gw = trimUrl(gatewayRaw);
  if (gw) {
    return { backend: "gateway", url: `${gw}${audioPath}`, available: true, displayHost: displayHost(gw) };
  }
  return { backend: "none", url: "", available: false, displayHost: "" };
}
function resolveSttTarget(env, displayHost = identityHost) {
  return resolve(env.sttUrl, env.gatewayUrl, "/v1/audio/transcriptions", displayHost);
}
function resolveTtsTarget(env, displayHost = identityHost) {
  return resolve(env.ttsUrl, env.gatewayUrl, "/v1/audio/speech", displayHost);
}
function audioConfigView(env, displayHost = identityHost) {
  const stt = resolveSttTarget(env, displayHost);
  const tts = resolveTtsTarget(env, displayHost);
  return {
    stt: { available: stt.available, backend: stt.backend, displayHost: stt.displayHost },
    tts: { serverAvailable: tts.available, backend: tts.backend, displayHost: tts.displayHost, browserFallback: true }
  };
}

// src/client.ts
var noAuth = (_t, extra = {}) => extra;
var DEFAULT_TIMEOUT_MS = 11e4;
var MAX_TTS_INPUT = 4e3;
function createSpeechClient(options) {
  const {
    env,
    authHeaders = noAuth,
    displayHost,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl
  } = options;
  const doFetch = fetchImpl ?? globalThis.fetch;
  async function transcribe(audio, opts = { filename: "audio.webm" }) {
    const target = resolveSttTarget(env, displayHost);
    if (!target.available) return { ok: false, reason: "not-configured" };
    const body = new FormData();
    body.append("file", audio, opts.filename);
    if (opts.model) body.append("model", opts.model);
    const r = await doFetch(target.url, {
      method: "POST",
      headers: authHeaders(target),
      body,
      signal: AbortSignal.timeout(timeoutMs)
    }).catch(() => null);
    if (!r || !r.ok) return { ok: false, reason: "unavailable" };
    const j = await r.json().catch(() => ({}));
    return { ok: true, text: typeof j?.text === "string" ? j.text : "" };
  }
  async function speak(text, opts = {}) {
    const target = resolveTtsTarget(env, displayHost);
    if (!target.available) return { ok: false, reason: "not-configured" };
    const payload = {
      model: opts.model ?? "tts",
      input: text.slice(0, MAX_TTS_INPUT),
      voice: opts.voice ?? "alloy"
    };
    const r = await doFetch(target.url, {
      method: "POST",
      headers: authHeaders(target, { "content-type": "application/json" }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    }).catch(() => null);
    if (!r || !r.ok || !r.body) return { ok: false, reason: "unavailable" };
    return {
      ok: true,
      body: r.body,
      contentType: r.headers.get("content-type") ?? "audio/mpeg"
    };
  }
  return { transcribe, speak };
}

// src/catalog.ts
var STT_MODELS = [
  {
    id: "parakeet",
    kind: "stt",
    label: "Fast transcription",
    engine: "nvidia-parakeet-tdt",
    notes: "Fastest, high-accuracy dictation. Best default for voice input."
  },
  {
    id: "whisper",
    kind: "stt",
    label: "Accurate transcription",
    engine: "whisper.cpp",
    notes: "Broad language coverage and robust on noisy audio; a little slower."
  }
];
var TTS_MODELS = [
  {
    id: "orpheus",
    kind: "tts",
    label: "Natural voice",
    engine: "orpheus-gguf",
    notes: "Most natural, expressive read-aloud. Best default when available.",
    voices: [
      { id: "tara", label: "Tara" },
      { id: "leah", label: "Leah" },
      { id: "leo", label: "Leo" },
      { id: "dan", label: "Dan" },
      { id: "mia", label: "Mia" },
      { id: "zac", label: "Zac" }
    ]
  },
  {
    id: "kokoro",
    kind: "tts",
    label: "Light voice",
    engine: "kokoro-82m",
    notes: "Small, fast, low-resource voice. Reliable fallback on lighter hardware.",
    voices: [
      { id: "af_heart", label: "Heart" },
      { id: "af_bella", label: "Bella" },
      { id: "am_michael", label: "Michael" },
      { id: "bf_emma", label: "Emma" },
      { id: "bm_george", label: "George" }
    ]
  }
];
var SPEECH_MODELS = [...STT_MODELS, ...TTS_MODELS];
var defaultStt = "parakeet";
var defaultTts = "orpheus";
function listSpeechModels(kind) {
  return SPEECH_MODELS.filter((m) => m.kind === kind);
}
function getSpeechModel(id) {
  return SPEECH_MODELS.find((m) => m.id === id);
}
function defaultVoice(modelId) {
  const m = getSpeechModel(modelId);
  return m?.voices && m.voices.length > 0 ? m.voices[0].id : void 0;
}
export {
  RECORDER_MIME_PREFERENCE,
  SPEECH_MODELS,
  audioConfigView,
  audioFilename,
  chooseRecorderMime,
  createSpeechClient,
  defaultStt,
  defaultTts,
  defaultVoice,
  getSpeechModel,
  listSpeechModels,
  resolveSttTarget,
  resolveTtsTarget
};
