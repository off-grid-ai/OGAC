import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mergeGuardResponses } from '../scripts/lib/guard-merge.mjs';

// The guardrail aggregator shards the LLM Guard scanner suite across fleet nodes (S1 = PII/DLP,
// S2 = heavy classifiers) because the full suite OOMs one 7.8 GB VM. mergeGuardResponses folds the
// per-shard verdicts back into the single { is_valid, scanners, sanitized_prompt } the console reads.
// These tests pin the merge policy: AND over answering shards, union of scanners, redaction from the
// shard that changed the text, and fail-closed on a required shard vs degrade on an optional one.

const PII = {
  name: 'pii',
  required: true,
  ok: true,
  status: 200,
  body: {
    is_valid: false,
    scanners: { Anonymize: 1.0, Secrets: -1.0, BanSubstrings: 1.0 },
    sanitized_prompt: 'Email [REDACTED_EMAIL_ADDRESS_1]',
  },
};
const CLASSIFIERS_CLEAN = {
  name: 'classifiers',
  required: false,
  ok: true,
  status: 200,
  body: {
    is_valid: true,
    scanners: { PromptInjection: 0.02, Toxicity: 0.01 },
    sanitized_prompt: 'Email raj@example.com', // classifier shard does not redact → == original-ish
  },
};

test('unions scanners across shards and keeps the redacting shard sanitized_prompt', () => {
  const original = 'Email raj@example.com';
  const { merged, blocked, degraded, answered } = mergeGuardResponses(original, [
    PII,
    CLASSIFIERS_CLEAN,
  ]);
  assert.equal(merged.is_valid, false); // PII shard tripped → whole verdict invalid
  assert.deepEqual(Object.keys(merged.scanners).sort(), [
    'Anonymize',
    'BanSubstrings',
    'PromptInjection',
    'Secrets',
    'Toxicity',
  ]);
  assert.equal(merged.sanitized_prompt, 'Email [REDACTED_EMAIL_ADDRESS_1]'); // from PII shard
  assert.equal(blocked, false);
  assert.deepEqual(degraded, []);
  assert.deepEqual(answered.sort(), ['classifiers', 'pii']);
});

test('is_valid is AND — a clean PII shard + a tripping classifier shard is still invalid', () => {
  const injection = {
    name: 'classifiers',
    required: false,
    ok: true,
    body: { is_valid: false, scanners: { PromptInjection: 0.98 } },
  };
  const cleanPii = {
    name: 'pii',
    required: true,
    ok: true,
    body: { is_valid: true, scanners: { Anonymize: -1.0 }, sanitized_prompt: 'hi' },
  };
  const { merged } = mergeGuardResponses('hi', [cleanPii, injection]);
  assert.equal(merged.is_valid, false);
  assert.equal(merged.scanners.PromptInjection, 0.98);
});

test('all shards clean → valid, sanitized_prompt is the original', () => {
  const a = { name: 'pii', required: true, ok: true, body: { is_valid: true, scanners: {}, sanitized_prompt: 'ok' } };
  const b = { name: 'classifiers', required: false, ok: true, body: { is_valid: true, scanners: { Toxicity: 0.0 } } };
  const { merged, blocked, degraded } = mergeGuardResponses('ok', [a, b]);
  assert.equal(merged.is_valid, true);
  assert.equal(merged.sanitized_prompt, 'ok');
  assert.equal(blocked, false);
  assert.deepEqual(degraded, []);
});

test('required shard failure → blocked (caller must fail closed)', () => {
  const down = { name: 'pii', required: true, ok: false, status: 502, body: null };
  const { blocked, degraded, answered } = mergeGuardResponses('x', [down, CLASSIFIERS_CLEAN]);
  assert.equal(blocked, true);
  assert.deepEqual(degraded, []);
  assert.deepEqual(answered, ['classifiers']);
});

test('optional shard failure → degraded, verdict stands on the answering shard', () => {
  const down = { name: 'classifiers', required: false, ok: false, status: 0, body: null };
  const { merged, blocked, degraded, answered } = mergeGuardResponses('Email raj@example.com', [
    PII,
    down,
  ]);
  assert.equal(blocked, false);
  assert.deepEqual(degraded, ['classifiers']);
  assert.deepEqual(answered, ['pii']);
  assert.equal(merged.is_valid, false); // PII shard still authoritative
  assert.equal(merged.sanitized_prompt, 'Email [REDACTED_EMAIL_ADDRESS_1]');
});

test('duplicate scanner name keeps the riskier (lower) score', () => {
  const a = { name: 'a', required: true, ok: true, body: { is_valid: true, scanners: { Toxicity: 0.9 } } };
  const b = { name: 'b', required: false, ok: true, body: { is_valid: true, scanners: { Toxicity: 0.1 } } };
  const { merged } = mergeGuardResponses('x', [a, b]);
  assert.equal(merged.scanners.Toxicity, 0.1);
});

test('malformed / empty inputs never throw and degrade sensibly', () => {
  assert.deepEqual(mergeGuardResponses('x', []), {
    merged: { is_valid: true, scanners: {}, sanitized_prompt: 'x' },
    blocked: false,
    degraded: [],
    answered: [],
  });
  // non-array shards, non-string original, junk bodies
  const r = mergeGuardResponses(undefined as unknown as string, undefined as unknown as []);
  assert.equal(r.merged.is_valid, true);
  assert.equal(r.merged.sanitized_prompt, '');
  const junk = mergeGuardResponses('p', [
    { name: 'j', required: true, ok: true, body: { scanners: { X: 'nan' as unknown as number } } },
    { name: 'k', required: false, ok: true, body: null },
  ]);
  assert.deepEqual(junk.merged.scanners, {}); // non-finite score dropped
  assert.equal(junk.merged.is_valid, true); // no explicit is_valid:false anywhere
});
