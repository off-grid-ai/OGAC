import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECORDER_MIME_PREFERENCE,
  chooseRecorderMime,
  audioFilename,
  resolveSttTarget,
  resolveTtsTarget,
  audioConfigView,
  SPEECH_MODELS,
  defaultStt,
  defaultTts,
  listSpeechModels,
  getSpeechModel,
  defaultVoice,
  createSpeechClient,
} from '../dist/index.js';

// Pure tests — NO mocks for the pure layer; the client tests inject a fake fetch (the one seam).

// ── MIME / filename ──────────────────────────────────────────────────────────
test('chooseRecorderMime: picks the first supported preferred type', () => {
  assert.equal(chooseRecorderMime((m) => m === 'audio/webm;codecs=opus'), 'audio/webm;codecs=opus');
  assert.equal(chooseRecorderMime((m) => m === 'audio/mp4'), 'audio/mp4');
  assert.equal(chooseRecorderMime(() => false), '');
});

test('RECORDER_MIME_PREFERENCE: webm/opus is first (widest support)', () => {
  assert.equal(RECORDER_MIME_PREFERENCE[0], 'audio/webm;codecs=opus');
});

test('audioFilename: maps mime (with codecs) to the right extension', () => {
  assert.equal(audioFilename('audio/webm;codecs=opus'), 'audio.webm');
  assert.equal(audioFilename('audio/mp4'), 'audio.mp4');
  assert.equal(audioFilename('audio/mpeg'), 'audio.mp3');
  assert.equal(audioFilename('audio/ogg;codecs=opus'), 'audio.ogg');
  assert.equal(audioFilename(''), 'audio.webm');
});

// ── Target resolution (air-gap: dedicated → gateway → none) ────────────────────
test('resolveSttTarget: dedicated STT wins over gateway', () => {
  const t = resolveSttTarget({ sttUrl: 'http://192.168.1.59:9001', gatewayUrl: 'http://127.0.0.1:7878' });
  assert.equal(t.backend, 'dedicated');
  assert.equal(t.url, 'http://192.168.1.59:9001/v1/audio/transcriptions');
  assert.equal(t.available, true);
});

test('resolveSttTarget: falls back to the gateway when no dedicated STT', () => {
  const t = resolveSttTarget({ gatewayUrl: 'http://127.0.0.1:7878' });
  assert.equal(t.backend, 'gateway');
  assert.equal(t.url, 'http://127.0.0.1:7878/v1/audio/transcriptions');
  assert.equal(t.available, true);
});

test('resolveSttTarget: nothing configured → unavailable, empty url', () => {
  const t = resolveSttTarget({});
  assert.equal(t.backend, 'none');
  assert.equal(t.url, '');
  assert.equal(t.available, false);
  assert.equal(t.displayHost, '');
});

test('resolveTtsTarget: dedicated / gateway / none + speech path', () => {
  assert.equal(resolveTtsTarget({ ttsUrl: 'http://x:1' }).url, 'http://x:1/v1/audio/speech');
  assert.equal(resolveTtsTarget({ gatewayUrl: 'http://x:2' }).url, 'http://x:2/v1/audio/speech');
  assert.equal(resolveTtsTarget({}).backend, 'none');
});

test('resolve*: trailing slashes are trimmed before appending the audio path', () => {
  const t = resolveSttTarget({ gatewayUrl: 'http://127.0.0.1:7878///' });
  assert.equal(t.url, 'http://127.0.0.1:7878/v1/audio/transcriptions');
});

test('displayHost fn is applied to the resolved base (injectable app policy)', () => {
  const mapper = (u) => u.replace('127.0.0.1', 'offgrid-s1.local');
  const t = resolveSttTarget({ gatewayUrl: 'http://127.0.0.1:7878' }, mapper);
  assert.match(t.displayHost, /offgrid-s1\.local/);
  assert.doesNotMatch(t.displayHost, /127\.0\.0\.1/);
});

test('audioConfigView: honest availability + browser fallback always true', () => {
  const v = audioConfigView({ gatewayUrl: 'http://127.0.0.1:7878' });
  assert.equal(v.stt.available, true);
  assert.equal(v.tts.serverAvailable, true);
  assert.equal(v.tts.browserFallback, true);
  const none = audioConfigView({});
  assert.equal(none.stt.available, false);
  assert.equal(none.tts.serverAvailable, false);
  assert.equal(none.tts.browserFallback, true);
});

// ── Catalog integrity ──────────────────────────────────────────────────────────
test('catalog: ids are unique', () => {
  const ids = SPEECH_MODELS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('catalog: every kind is stt or tts', () => {
  for (const m of SPEECH_MODELS) assert.ok(m.kind === 'stt' || m.kind === 'tts', m.id);
});

test('catalog: keep-both — parakeet+whisper (stt), orpheus+kokoro (tts)', () => {
  assert.deepEqual(
    listSpeechModels('stt').map((m) => m.id).sort(),
    ['parakeet', 'whisper'],
  );
  assert.deepEqual(
    listSpeechModels('tts').map((m) => m.id).sort(),
    ['kokoro', 'orpheus'],
  );
});

test('catalog: defaults exist and are the right kind', () => {
  assert.equal(getSpeechModel(defaultStt)?.kind, 'stt');
  assert.equal(getSpeechModel(defaultTts)?.kind, 'tts');
  assert.equal(defaultStt, 'parakeet');
  assert.equal(defaultTts, 'orpheus');
});

test('catalog: TTS models carry voices, STT models do not; defaultVoice resolves', () => {
  for (const m of listSpeechModels('tts')) assert.ok(m.voices && m.voices.length > 0, m.id);
  for (const m of listSpeechModels('stt')) assert.ok(!m.voices, m.id);
  assert.ok(typeof defaultVoice(defaultTts) === 'string');
  assert.equal(defaultVoice(defaultStt), undefined);
});

test('catalog: user-facing labels never leak an OSS-internal engine name', () => {
  const banned = /parakeet|whisper|orpheus|kokoro|nvidia|gguf|llama|\.cpp/i;
  for (const m of SPEECH_MODELS) {
    assert.doesNotMatch(m.label, banned, `label leaks engine: ${m.id}`);
    assert.doesNotMatch(m.notes, banned, `notes leaks engine: ${m.id}`);
  }
});

// ── Client I/O (fake fetch is the ONLY seam) ───────────────────────────────────
function blob(s) {
  return new Blob([s], { type: 'audio/webm' });
}

test('transcribe: not-configured when nothing wired (no throw)', async () => {
  const c = createSpeechClient({ env: {}, fetchImpl: async () => { throw new Error('should not call'); } });
  const r = await c.transcribe(blob('x'), { filename: 'audio.webm' });
  assert.deepEqual(r, { ok: false, reason: 'not-configured' });
});

test('transcribe: posts multipart to /v1/audio/transcriptions and returns text', async () => {
  let seenUrl, seenMethod, sawFile = false, sawModel = false;
  const fake = async (url, init) => {
    seenUrl = url; seenMethod = init.method;
    sawFile = init.body.get('file') instanceof Blob;
    sawModel = init.body.get('model') === 'parakeet';
    return new Response(JSON.stringify({ text: 'hello world' }), { status: 200 });
  };
  const c = createSpeechClient({ env: { gatewayUrl: 'http://127.0.0.1:7878' }, fetchImpl: fake });
  const r = await c.transcribe(blob('x'), { filename: 'audio.webm', model: 'parakeet' });
  assert.deepEqual(r, { ok: true, text: 'hello world' });
  assert.equal(seenUrl, 'http://127.0.0.1:7878/v1/audio/transcriptions');
  assert.equal(seenMethod, 'POST');
  assert.ok(sawFile);
  assert.ok(sawModel);
});

test('transcribe: upstream error → unavailable (no throw)', async () => {
  const c = createSpeechClient({ env: { gatewayUrl: 'http://x:1' }, fetchImpl: async () => { throw new Error('net'); } });
  assert.deepEqual(await c.transcribe(blob('x'), { filename: 'a.webm' }), { ok: false, reason: 'unavailable' });
  const c2 = createSpeechClient({ env: { gatewayUrl: 'http://x:1' }, fetchImpl: async () => new Response('nope', { status: 500 }) });
  assert.deepEqual(await c2.transcribe(blob('x'), { filename: 'a.webm' }), { ok: false, reason: 'unavailable' });
});

test('speak: not-configured when no TTS target', async () => {
  const c = createSpeechClient({ env: {} });
  assert.deepEqual(await c.speak('hi'), { ok: false, reason: 'not-configured' });
});

test('speak: posts JSON to /v1/audio/speech with model+voice, streams audio', async () => {
  let body;
  const fake = async (url, init) => {
    body = JSON.parse(init.body);
    return new Response(new Blob(['AUDIO']).stream(), { status: 200, headers: { 'content-type': 'audio/wav' } });
  };
  const c = createSpeechClient({ env: { ttsUrl: 'http://127.0.0.1:9002' }, fetchImpl: fake });
  const r = await c.speak('read this', { model: 'orpheus', voice: 'tara' });
  assert.equal(r.ok, true);
  assert.equal(r.contentType, 'audio/wav');
  assert.equal(body.model, 'orpheus');
  assert.equal(body.voice, 'tara');
  assert.equal(body.input, 'read this');
});

test('auth headers are injected only where the app decides (gateway vs dedicated)', async () => {
  const seen = {};
  const authHeaders = (target, extra = {}) =>
    target.backend === 'gateway' ? { ...extra, 'x-api-key': 'secret' } : extra;
  const fake = async (url, init) => { seen[url] = init.headers; return new Response(JSON.stringify({ text: '' })); };
  const gw = createSpeechClient({ env: { gatewayUrl: 'http://gw:1' }, authHeaders, fetchImpl: fake });
  await gw.transcribe(blob('x'), { filename: 'a.webm' });
  assert.equal(seen['http://gw:1/v1/audio/transcriptions']['x-api-key'], 'secret');
  const ded = createSpeechClient({ env: { sttUrl: 'http://ded:1' }, authHeaders, fetchImpl: fake });
  await ded.transcribe(blob('x'), { filename: 'a.webm' });
  assert.equal(seen['http://ded:1/v1/audio/transcriptions']['x-api-key'], undefined);
});
