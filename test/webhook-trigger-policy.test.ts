import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  SIG_PREFIX,
  computeSignature,
  isWebhookTargetKind,
  parseSigHeader,
  signingBase,
  verifyWebhook,
  withinWindow,
} from '@/lib/webhook-trigger-policy';

const SECRET = 'whsec_test_key';
const BODY = JSON.stringify({ input: 'hello', claim: 25000 });
const NOW = 1_800_000_000_000; // fixed ms
const TS = String(Math.floor(NOW / 1000)); // seconds

test('computeSignature matches a manual HMAC over `${ts}.${body}`', () => {
  const expected = SIG_PREFIX + createHmac('sha256', SECRET).update(`${TS}.${BODY}`).digest('hex');
  assert.equal(computeSignature(TS, BODY, SECRET), expected);
  assert.equal(signingBase(TS, BODY), `${TS}.${BODY}`);
});

test('parseSigHeader accepts only well-formed sha256= headers', () => {
  assert.equal(parseSigHeader('sha256=abc'), 'sha256=abc');
  assert.equal(parseSigHeader('  sha256=abc  '), 'sha256=abc');
  assert.equal(parseSigHeader('sha256='), null); // prefix only
  assert.equal(parseSigHeader('md5=abc'), null);
  assert.equal(parseSigHeader(''), null);
  assert.equal(parseSigHeader(null), null);
  assert.equal(parseSigHeader(undefined), null);
});

test('withinWindow accepts seconds and ms, rejects skew/garbage', () => {
  assert.equal(withinWindow(TS, NOW, 300), true); // in-window seconds
  assert.equal(withinWindow(String(NOW), NOW, 300), true); // in-window ms
  assert.equal(withinWindow(String(Math.floor(NOW / 1000) - 3600), NOW, 300), false); // 1h old
  assert.equal(withinWindow(String(Math.floor(NOW / 1000) + 3600), NOW, 300), false); // 1h future
  assert.equal(withinWindow('not-a-number', NOW, 300), false);
  assert.equal(withinWindow('', NOW, 300), false);
  assert.equal(withinWindow('0', NOW, 300), false);
  assert.equal(withinWindow(null, NOW, 300), false);
});

test('verifyWebhook — happy path', () => {
  const sig = computeSignature(TS, BODY, SECRET);
  const r = verifyWebhook({ rawBody: BODY, signature: sig, timestamp: TS, secret: SECRET, nowMs: NOW });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.sig, sig);
});

test('verifyWebhook — rejects missing secret / signature / timestamp', () => {
  const sig = computeSignature(TS, BODY, SECRET);
  assert.equal(verifyWebhook({ rawBody: BODY, signature: sig, timestamp: TS, secret: null, nowMs: NOW }).ok, false);
  assert.equal(verifyWebhook({ rawBody: BODY, signature: null, timestamp: TS, secret: SECRET, nowMs: NOW }).ok, false);
  assert.equal(verifyWebhook({ rawBody: BODY, signature: sig, timestamp: null, secret: SECRET, nowMs: NOW }).ok, false);
});

test('verifyWebhook — rejects expired timestamp (replay outside window)', () => {
  const oldTs = String(Math.floor(NOW / 1000) - 4000);
  const sig = computeSignature(oldTs, BODY, SECRET);
  const r = verifyWebhook({ rawBody: BODY, signature: sig, timestamp: oldTs, secret: SECRET, nowMs: NOW });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /timestamp/i);
});

test('verifyWebhook — rejects a tampered body (signature mismatch)', () => {
  const sig = computeSignature(TS, BODY, SECRET);
  const r = verifyWebhook({ rawBody: BODY + 'x', signature: sig, timestamp: TS, secret: SECRET, nowMs: NOW });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 401);
});

test('verifyWebhook — wrong secret fails, and unequal-length sig does not throw', () => {
  const sig = computeSignature(TS, BODY, 'other-secret');
  assert.equal(verifyWebhook({ rawBody: BODY, signature: sig, timestamp: TS, secret: SECRET, nowMs: NOW }).ok, false);
  // A short/garbage signature must be handled by the length guard, not throw.
  const r = verifyWebhook({ rawBody: BODY, signature: 'sha256=deadbeef', timestamp: TS, secret: SECRET, nowMs: NOW });
  assert.equal(r.ok, false);
});

test('isWebhookTargetKind', () => {
  assert.equal(isWebhookTargetKind('app'), true);
  assert.equal(isWebhookTargetKind('agent'), true);
  assert.equal(isWebhookTargetKind('chat'), false);
  assert.equal(isWebhookTargetKind(null), false);
});
