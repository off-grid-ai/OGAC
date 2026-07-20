// PURE tests for the OUTPUT PII mask-vs-block decision (piiOutputVerdict). This is the fix that lets
// a PII-by-design workflow (e.g. a claims decision) RELEASE a masked answer instead of fail-closing
// to blocked — but ONLY when the pipeline required masking AND the engine returned a usable sanitized
// form. Every other arm must stay fail-closed. Security-critical: assert the block branches hold.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { piiOutputVerdict, type PiiCheckInput } from '../src/lib/checks.ts';

const withHits = (over: Partial<PiiCheckInput> = {}): PiiCheckInput => ({
  hits: true,
  entities: ['IN_PAN'],
  engine: 'llm-guard',
  configured: true,
  ...over,
});

test('masking required + sanitized output present → redacted, carries the sanitized text', () => {
  const v = piiOutputVerdict(withHits({ redacted: 'PAN [REDACTED]' }), true);
  assert.equal(v.verdict, 'redacted');
  assert.equal(v.redactedText, 'PAN [REDACTED]');
  assert.match(v.detail ?? '', /masked for release/);
});

test('masking NOT required + hits → blocked (fail-closed, unchanged default)', () => {
  const v = piiOutputVerdict(withHits({ redacted: 'PAN [REDACTED]' }), false);
  assert.equal(v.verdict, 'blocked');
  assert.equal(v.redactedText, undefined);
  assert.match(v.detail ?? '', /blocked release/);
});

test('default (no flag) is fail-closed blocked', () => {
  assert.equal(piiOutputVerdict(withHits({ redacted: 'x' })).verdict, 'blocked');
});

test('masking required but NO sanitized form → blocked (never release raw PII)', () => {
  const v = piiOutputVerdict(withHits({ redacted: undefined }), true);
  assert.equal(v.verdict, 'blocked');
  assert.equal(v.redactedText, undefined);
});

test('masking required but engine unavailable (blocked result) → blocked', () => {
  const v = piiOutputVerdict(
    { hits: true, entities: ['x'], engine: 'llm-guard', blocked: true, redacted: 'ignored' },
    true,
  );
  assert.equal(v.verdict, 'blocked');
  assert.equal(v.redactedText, undefined);
});

test('no hits → pass, regardless of masking flag', () => {
  assert.equal(piiOutputVerdict({ hits: false, entities: [], engine: 'llm-guard', configured: true }, true).verdict, 'pass');
  assert.equal(piiOutputVerdict({ hits: false, entities: [], engine: 'llm-guard', configured: true }, false).verdict, 'pass');
});

test('not-configured → warn (never a fake clean pass), even with masking required', () => {
  const v = piiOutputVerdict({ hits: false, entities: [], engine: 'none', configured: false }, true);
  assert.equal(v.verdict, 'warn');
  assert.equal(v.redactedText, undefined);
});
