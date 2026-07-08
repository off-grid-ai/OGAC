import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyPiiEscalation,
  effectiveBlockPromptInjection,
  effectivePiiMasking,
} from '@/lib/pii-escalation';
import type { PiiScanLike } from '@/lib/guardrail-rules-runtime';

// ─── effectivePiiMasking — the MAX(floor, overlay) escalation decision ─────────────────────────────

test('effectivePiiMasking: floor OFF + no verdict ⇒ OFF (no pipeline, legacy)', () => {
  assert.equal(effectivePiiMasking(false, null), false);
});

test('effectivePiiMasking: floor ON + no verdict ⇒ ON (floor alone masks)', () => {
  assert.equal(effectivePiiMasking(true, null), true);
});

test('effectivePiiMasking: floor OFF + overlay ESCALATES on ⇒ ON (overlay tightens above floor)', () => {
  assert.equal(effectivePiiMasking(false, { requirePiiMasking: true }), true);
});

test('effectivePiiMasking: floor OFF + overlay off ⇒ OFF', () => {
  assert.equal(effectivePiiMasking(false, { requirePiiMasking: false }), false);
});

test('effectivePiiMasking: floor ON + overlay off ⇒ ON (overlay can NEVER loosen below the floor)', () => {
  // max-not-replace: even a verdict that (wrongly) reports masking off cannot drop below the floor.
  assert.equal(effectivePiiMasking(true, { requirePiiMasking: false }), true);
});

test('effectivePiiMasking: floor ON + overlay on ⇒ ON', () => {
  assert.equal(effectivePiiMasking(true, { requirePiiMasking: true }), true);
});

// ─── effectiveBlockPromptInjection — same MAX(floor, overlay) rule ─────────────────────────────────

test('effectiveBlockPromptInjection: floor OFF + no verdict ⇒ OFF', () => {
  assert.equal(effectiveBlockPromptInjection(false, null), false);
});

test('effectiveBlockPromptInjection: overlay escalates on above an off floor ⇒ ON', () => {
  assert.equal(effectiveBlockPromptInjection(false, { blockPromptInjection: true }), true);
});

test('effectiveBlockPromptInjection: off floor + overlay off ⇒ OFF', () => {
  assert.equal(effectiveBlockPromptInjection(false, { blockPromptInjection: false }), false);
});

test('effectiveBlockPromptInjection: floor ON + overlay off ⇒ ON (never loosen below floor)', () => {
  assert.equal(effectiveBlockPromptInjection(true, { blockPromptInjection: false }), true);
});

// ─── applyPiiEscalation — the raw→redacted substitution + escalation outcome ───────────────────────

const RAW = 'email alice@example.com about PAN ABCPE1234F';
const REDACTED = 'email [EMAIL] about PAN [PAN]';

function scan(over: Partial<PiiScanLike> = {}): PiiScanLike {
  return { hits: true, redacted: REDACTED, ...over };
}

test('applyPiiEscalation: NOT required ⇒ text unchanged, masked false (additive/legacy)', () => {
  const r = applyPiiEscalation(RAW, false, scan());
  assert.equal(r.text, RAW, 'the raw text is returned untouched when masking is not required');
  assert.equal(r.masked, false);
  assert.equal(r.required, false);
});

test('applyPiiEscalation: required + PII found ⇒ REDACTED text (raw value never leaves)', () => {
  const r = applyPiiEscalation(RAW, true, scan());
  assert.equal(r.text, REDACTED);
  assert.equal(r.masked, true);
  assert.equal(r.required, true);
  assert.ok(!r.text.includes('alice@example.com'), 'the raw email is gone');
  assert.ok(!r.text.includes('ABCPE1234F'), 'the raw PAN is gone');
});

test('applyPiiEscalation: required but scan found NOTHING ⇒ original text, masked false', () => {
  // Masking was required, but there was simply nothing to mask (no hits) — the text stands.
  const r = applyPiiEscalation(RAW, true, { hits: false });
  assert.equal(r.text, RAW);
  assert.equal(r.masked, false);
  assert.equal(r.required, true);
});

test('applyPiiEscalation: required + hits but redacted EQUALS original ⇒ masked false', () => {
  // A degenerate scan whose redaction equals the input (nothing actually changed) is not a mask.
  const r = applyPiiEscalation(RAW, true, { hits: true, redacted: RAW });
  assert.equal(r.text, RAW);
  assert.equal(r.masked, false);
  assert.equal(r.required, true);
});

test('applyPiiEscalation: required + hits but no redacted string ⇒ original, masked false', () => {
  const r = applyPiiEscalation(RAW, true, { hits: true });
  assert.equal(r.text, RAW);
  assert.equal(r.masked, false);
});
