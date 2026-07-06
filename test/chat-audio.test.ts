import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  audioConfigView,
  audioFilename,
  canSpeak,
  chooseRecorderMime,
  isCapturing,
  mergeTranscript,
  nextRecordPhase,
  nextSpeakPhase,
  normalizeLevel,
  recordButtonLabel,
  resolveSttTarget,
  resolveTtsTarget,
  speakBackend,
  speakButtonLabel,
  textForSpeech,
} from '@/lib/chat-audio';

// Pure tests for chat audio (STT + TTS) — NO React, NO fetch, NO mocks. These govern the air-gap
// resolution rules, the two state machines, and the text/mime shaping.

// ── MIME / filename ─────────────────────────────────────────────────────────
test('chooseRecorderMime: picks the first supported preferred type', () => {
  assert.equal(chooseRecorderMime((m) => m === 'audio/webm;codecs=opus'), 'audio/webm;codecs=opus');
  // Safari-ish: only mp4 supported
  assert.equal(chooseRecorderMime((m) => m === 'audio/mp4'), 'audio/mp4');
  // Nothing supported → '' so the caller lets the UA choose
  assert.equal(chooseRecorderMime(() => false), '');
});

test('audioFilename: maps mime (with codecs) to the right extension', () => {
  assert.equal(audioFilename('audio/webm;codecs=opus'), 'audio.webm');
  assert.equal(audioFilename('audio/mp4'), 'audio.mp4');
  assert.equal(audioFilename('audio/mpeg'), 'audio.mp3');
  assert.equal(audioFilename('audio/ogg;codecs=opus'), 'audio.ogg');
  assert.equal(audioFilename(''), 'audio.webm'); // default
});

// ── Config resolution (air-gap targets) ──────────────────────────────────────
test('resolveSttTarget: dedicated STT wins over gateway', () => {
  const t = resolveSttTarget({ sttUrl: 'http://127.0.0.1:9001', gatewayUrl: 'http://127.0.0.1:7878' });
  assert.equal(t.backend, 'dedicated');
  assert.equal(t.url, 'http://127.0.0.1:9001/v1/audio/transcriptions');
  assert.equal(t.available, true);
  // never shows a raw IP / loopback — mDNS display host
  assert.match(t.displayHost, /offgrid-s1\.local/);
});

test('resolveSttTarget: falls back to the gateway when no dedicated STT', () => {
  const t = resolveSttTarget({ gatewayUrl: 'http://127.0.0.1:7878' });
  assert.equal(t.backend, 'gateway');
  assert.equal(t.url, 'http://127.0.0.1:7878/v1/audio/transcriptions');
  assert.equal(t.available, true);
  assert.match(t.displayHost, /offgrid-s1\.local/); // loopback → S1, never 127.0.0.1
});

test('resolveSttTarget: nothing configured → unavailable, empty url', () => {
  const t = resolveSttTarget({});
  assert.equal(t.backend, 'none');
  assert.equal(t.available, false);
  assert.equal(t.url, '');
  assert.equal(t.displayHost, '');
});

test('resolveTtsTarget: dedicated / gateway / none', () => {
  assert.equal(resolveTtsTarget({ ttsUrl: 'http://127.0.0.1:9002' }).url, 'http://127.0.0.1:9002/v1/audio/speech');
  assert.equal(resolveTtsTarget({ gatewayUrl: 'http://127.0.0.1:7878' }).backend, 'gateway');
  assert.equal(resolveTtsTarget({}).available, false);
});

test('resolveTarget: trailing slashes on the base are normalised', () => {
  assert.equal(resolveSttTarget({ sttUrl: 'http://x.local:9001///' }).url, 'http://x.local:9001/v1/audio/transcriptions');
});

test('audioConfigView: honest client view; browser fallback always advertised', () => {
  const v = audioConfigView({ gatewayUrl: 'http://127.0.0.1:7878' });
  assert.equal(v.stt.available, true);
  assert.equal(v.tts.serverAvailable, true);
  assert.equal(v.tts.browserFallback, true);
  const none = audioConfigView({});
  assert.equal(none.stt.available, false);
  assert.equal(none.tts.serverAvailable, false);
  assert.equal(none.tts.browserFallback, true); // browser voice still offered
});

// ── Record state machine ──────────────────────────────────────────────────────
test('nextRecordPhase: happy path idle→recording→transcribing→idle', () => {
  let p = nextRecordPhase('idle', { type: 'start' });
  assert.equal(p, 'recording');
  p = nextRecordPhase(p, { type: 'stop' });
  assert.equal(p, 'transcribing');
  p = nextRecordPhase(p, { type: 'result' });
  assert.equal(p, 'idle');
});

test('nextRecordPhase: fail from any → error; reset → idle; invalid transitions no-op', () => {
  assert.equal(nextRecordPhase('recording', { type: 'fail' }), 'error');
  assert.equal(nextRecordPhase('error', { type: 'reset' }), 'idle');
  assert.equal(nextRecordPhase('error', { type: 'start' }), 'recording'); // error is recoverable
  assert.equal(nextRecordPhase('idle', { type: 'stop' }), 'idle'); // no-op
  assert.equal(nextRecordPhase('transcribing', { type: 'start' }), 'transcribing'); // no-op
});

test('isCapturing: only true while recording', () => {
  assert.equal(isCapturing('recording'), true);
  assert.equal(isCapturing('transcribing'), false);
  assert.equal(isCapturing('idle'), false);
});

test('recordButtonLabel: reflects availability + phase', () => {
  assert.equal(recordButtonLabel('idle', false), 'Voice input not configured');
  assert.equal(recordButtonLabel('idle', true), 'Dictate');
  assert.equal(recordButtonLabel('recording', true), 'Stop recording');
  assert.equal(recordButtonLabel('transcribing', true), 'Transcribing…');
});

test('mergeTranscript: appends with a space, trims, no-ops on empty', () => {
  assert.equal(mergeTranscript('Hello', 'world'), 'Hello world');
  assert.equal(mergeTranscript('', 'first'), 'first');
  assert.equal(mergeTranscript('keep', '   '), 'keep'); // empty transcript never clobbers
  assert.equal(mergeTranscript('  a ', ' b '), 'a b');
});

test('normalizeLevel: clamps to 0..1 and guards NaN/negatives', () => {
  assert.equal(normalizeLevel(64, 128), 0.5);
  assert.equal(normalizeLevel(500, 128), 1);
  assert.equal(normalizeLevel(-5), 0);
  assert.equal(normalizeLevel(NaN), 0);
  assert.equal(normalizeLevel(10, 0), 0);
});

// ── Speak state machine + backend ─────────────────────────────────────────────
test('nextSpeakPhase: loading→playing→paused→playing→idle', () => {
  let p = nextSpeakPhase('idle', { type: 'request' });
  assert.equal(p, 'loading');
  p = nextSpeakPhase(p, { type: 'ready' });
  assert.equal(p, 'playing');
  p = nextSpeakPhase(p, { type: 'pause' });
  assert.equal(p, 'paused');
  p = nextSpeakPhase(p, { type: 'resume' });
  assert.equal(p, 'playing');
  p = nextSpeakPhase(p, { type: 'ended' });
  assert.equal(p, 'idle');
});

test('nextSpeakPhase: stop/fail/reset + invalid no-ops', () => {
  assert.equal(nextSpeakPhase('playing', { type: 'stop' }), 'idle');
  assert.equal(nextSpeakPhase('loading', { type: 'fail' }), 'error');
  assert.equal(nextSpeakPhase('error', { type: 'reset' }), 'idle');
  assert.equal(nextSpeakPhase('idle', { type: 'pause' }), 'idle'); // no-op
  assert.equal(nextSpeakPhase('paused', { type: 'pause' }), 'paused'); // no-op
});

test('speakBackend: server preferred, browser fallback, else none', () => {
  assert.equal(speakBackend(true, true), 'server');
  assert.equal(speakBackend(true, false), 'server');
  assert.equal(speakBackend(false, true), 'browser');
  assert.equal(speakBackend(false, false), 'none');
});

test('canSpeak: true if any backend available', () => {
  assert.equal(canSpeak(false, true), true); // browser-only still speaks
  assert.equal(canSpeak(false, false), false);
});

test('speakButtonLabel: phase + backend', () => {
  assert.equal(speakButtonLabel('idle', 'none'), 'Read aloud not available');
  assert.equal(speakButtonLabel('idle', 'server'), 'Read aloud');
  assert.equal(speakButtonLabel('idle', 'browser'), 'Read aloud (browser voice)');
  assert.equal(speakButtonLabel('playing', 'server'), 'Pause');
  assert.equal(speakButtonLabel('paused', 'server'), 'Resume');
  assert.equal(speakButtonLabel('loading', 'server'), 'Preparing audio…');
});

// ── Text shaping for speech ────────────────────────────────────────────────────
test('textForSpeech: strips markdown/code/citations and collapses whitespace', () => {
  const md = '## Title\n\nSome **bold** and `code` and [a link](http://x) plus [1] a cite.\n\n```js\nignored();\n```';
  const out = textForSpeech(md);
  assert.ok(!out.includes('##'));
  assert.ok(!out.includes('**'));
  assert.ok(!out.includes('`'));
  assert.ok(!out.includes('[1]'));
  assert.ok(!out.includes('http://x'));
  assert.ok(!out.includes('ignored'));
  assert.ok(out.includes('a link')); // link text is kept
  assert.ok(out.includes('Some bold and code'));
});

test('textForSpeech: caps length', () => {
  const long = 'a'.repeat(5000);
  assert.equal(textForSpeech(long, 100).length, 100);
});
