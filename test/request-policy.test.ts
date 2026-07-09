import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkModelRules,
  checkRequestParams,
  checkRequestPolicy,
  parseModelRules,
  parseRequestParamsPolicy,
} from '../src/lib/request-policy.ts';

// PURE unit tests for the first-party deterministic request-shape gates: the Request Parameters
// Check (max_tokens ceiling / temperature|top_p bounds / banned params) and Model Rules
// (allowlist/denylist), plus the overlay parsers. No I/O; every allow AND deny arm is exercised.

// ─── Request Parameters Check ─────────────────────────────────────────────────────────────────────

test('no policy ⇒ no-op pass echoing the params unchanged', () => {
  const v = checkRequestParams(null, { max_tokens: 999999, foo: 'bar' });
  assert.equal(v.allow, true);
  assert.equal(v.noPolicy, true);
  assert.deepEqual(v.params, { max_tokens: 999999, foo: 'bar' });
  assert.deepEqual(v.clamped, []);
});

test('max_tokens over the ceiling is CLAMPED (not blocked) and recorded', () => {
  const v = checkRequestParams({ maxTokensCeiling: 1000 }, { max_tokens: 4000 });
  assert.equal(v.allow, true);
  assert.equal(v.params.max_tokens, 1000);
  assert.deepEqual(v.clamped, [{ param: 'max_tokens', from: 4000, to: 1000 }]);
  assert.match(v.reason, /clamped max_tokens 4000/);
});

test('max_tokens at/below the ceiling passes untouched', () => {
  const v = checkRequestParams({ maxTokensCeiling: 1000 }, { max_tokens: 1000 });
  assert.equal(v.params.max_tokens, 1000);
  assert.deepEqual(v.clamped, []);
  assert.match(v.reason, /within policy/);
});

test('a ceiling with no max_tokens on the request is a no-clamp pass', () => {
  const v = checkRequestParams({ maxTokensCeiling: 1000 }, { temperature: 0.5 });
  assert.equal(v.allow, true);
  assert.deepEqual(v.clamped, []);
});

test('temperature out of range ⇒ BLOCK (both under and over)', () => {
  const policy = { temperatureRange: { min: 0, max: 1 } };
  assert.equal(checkRequestParams(policy, { temperature: 1.5 }).allow, false);
  assert.equal(checkRequestParams(policy, { temperature: -0.1 }).allow, false);
  const ok = checkRequestParams(policy, { temperature: 0.7 });
  assert.equal(ok.allow, true);
});

test('top_p out of range ⇒ BLOCK; in range ⇒ allow', () => {
  const policy = { topPRange: { min: 0, max: 1 } };
  assert.equal(checkRequestParams(policy, { top_p: 2 }).allow, false);
  assert.equal(checkRequestParams(policy, { top_p: 0.9 }).allow, true);
});

test('a banned parameter present on the request ⇒ BLOCK', () => {
  const v = checkRequestParams({ bannedParams: ['logprobs', 'n'] }, { logprobs: true });
  assert.equal(v.allow, false);
  assert.match(v.reason, /banned parameter "logprobs"/);
});

test('banned param check ignores absent banned params and blank entries', () => {
  const v = checkRequestParams({ bannedParams: ['  ', 'n'] }, { temperature: 0.5 });
  assert.equal(v.allow, true, 'blank banned entries are dropped; n is not present');
});

test('non-numeric / NaN params are ignored by the bounds checks (never a spurious block)', () => {
  const policy = { temperatureRange: { min: 0, max: 1 }, topPRange: { min: 0, max: 1 } };
  // strings + NaN are not finite numbers → treated as "not supplied", so no block.
  assert.equal(checkRequestParams(policy, { temperature: 'hot', top_p: NaN }).allow, true);
});

test('an invalid (unordered) range is ignored rather than blocking everything', () => {
  const v = checkRequestParams({ temperatureRange: { min: 1, max: 0 } }, { temperature: 5 });
  assert.equal(v.allow, true, 'a min>max range is treated as absent');
});

test('a ceiling of 0 clamps everything positive to 0', () => {
  const v = checkRequestParams({ maxTokensCeiling: 0 }, { max_tokens: 10 });
  assert.equal(v.params.max_tokens, 0);
  assert.deepEqual(v.clamped, [{ param: 'max_tokens', from: 10, to: 0 }]);
});

// ─── Model Rules ────────────────────────────────────────────────────────────────────────────────

test('no rules ⇒ no-op pass', () => {
  const v = checkModelRules(null, 'gpt-4o');
  assert.equal(v.allow, true);
  assert.equal(v.noRules, true);
});

test('empty allow + deny lists ⇒ no-op pass', () => {
  const v = checkModelRules({ allowlist: [], denylist: [] }, 'gpt-4o');
  assert.equal(v.allow, true);
  assert.equal(v.noRules, true);
});

test('allowlisted model passes; non-allowlisted model BLOCKS', () => {
  const rules = { allowlist: ['gemma-local', 'llama-3'] };
  assert.equal(checkModelRules(rules, 'gemma-local').allow, true);
  const blocked = checkModelRules(rules, 'gpt-4o');
  assert.equal(blocked.allow, false);
  assert.match(blocked.reason, /not on the pipeline allowlist/);
});

test('denylist wins over allowlist (deny-overrides)', () => {
  const rules = { allowlist: ['gpt-4o'], denylist: ['gpt-4o'] };
  const v = checkModelRules(rules, 'gpt-4o');
  assert.equal(v.allow, false);
  assert.match(v.reason, /denylisted/);
});

test('a denylisted model blocks even with no allowlist', () => {
  assert.equal(checkModelRules({ denylist: ['claude-cloud'] }, 'claude-cloud').allow, false);
  assert.equal(checkModelRules({ denylist: ['claude-cloud'] }, 'gemma-local').allow, true);
});

test('model comparison is case-insensitive and trimmed', () => {
  assert.equal(checkModelRules({ allowlist: ['Gemma-Local'] }, '  gemma-local ').allow, true);
  assert.equal(checkModelRules({ denylist: ['GPT-4O'] }, 'gpt-4o').allow, false);
});

test('an empty resolved model with any rule configured ⇒ BLOCK', () => {
  const v = checkModelRules({ allowlist: ['x'] }, '   ');
  assert.equal(v.allow, false);
  assert.match(v.reason, /no model resolved/);
});

// ─── composition ──────────────────────────────────────────────────────────────────────────────────

test('checkRequestPolicy ANDs both checks; params blocking short-circuits the reason', () => {
  const v = checkRequestPolicy(
    { bannedParams: ['logprobs'] },
    { allowlist: ['gemma-local'] },
    { logprobs: true },
    'gemma-local',
  );
  assert.equal(v.allow, false);
  assert.match(v.reason, /banned parameter/);
});

test('checkRequestPolicy blocks on the model when params pass', () => {
  const v = checkRequestPolicy(
    { maxTokensCeiling: 1000 },
    { denylist: ['gpt-4o'] },
    { max_tokens: 5000 },
    'gpt-4o',
  );
  assert.equal(v.allow, false);
  assert.match(v.reason, /denylisted/);
  // even though it blocks on the model, the params sub-verdict still clamped.
  assert.equal(v.params.params.max_tokens, 1000);
});

test('checkRequestPolicy passes both and combines the reasons', () => {
  const v = checkRequestPolicy(
    { maxTokensCeiling: 1000 },
    { allowlist: ['gemma-local'] },
    { max_tokens: 500 },
    'gemma-local',
  );
  assert.equal(v.allow, true);
  assert.match(v.reason, /within policy/);
  assert.match(v.reason, /permitted by the pipeline model rules/);
});

// ─── overlay parsers ──────────────────────────────────────────────────────────────────────────────

test('parseRequestParamsPolicy narrows a well-formed blob', () => {
  const p = parseRequestParamsPolicy({
    maxTokensCeiling: 2048,
    temperatureRange: { min: 0, max: 1 },
    topPRange: { min: 0, max: 1 },
    bannedParams: ['logprobs', ''],
    junk: 'ignored',
  });
  assert.deepEqual(p, {
    maxTokensCeiling: 2048,
    temperatureRange: { min: 0, max: 1 },
    topPRange: { min: 0, max: 1 },
    bannedParams: ['logprobs'],
  });
});

test('parseRequestParamsPolicy drops invalid pieces and returns undefined when nothing valid', () => {
  assert.equal(parseRequestParamsPolicy(null), undefined);
  assert.equal(parseRequestParamsPolicy('str'), undefined);
  assert.equal(parseRequestParamsPolicy({}), undefined);
  assert.equal(parseRequestParamsPolicy({ maxTokensCeiling: 'big' }), undefined);
  // A garbage range is dropped, so if it's the only key present → undefined.
  assert.equal(parseRequestParamsPolicy({ temperatureRange: { min: 5, max: 1 } }), undefined);
  // A partial-but-valid blob keeps only the valid key.
  assert.deepEqual(parseRequestParamsPolicy({ maxTokensCeiling: 100, bannedParams: 5 }), {
    maxTokensCeiling: 100,
  });
});

test('parseModelRules narrows allow/deny lists and drops blanks', () => {
  assert.deepEqual(parseModelRules({ allowlist: ['a', ''], denylist: ['b'] }), {
    allowlist: ['a'],
    denylist: ['b'],
  });
  assert.deepEqual(parseModelRules({ allowlist: ['only'] }), { allowlist: ['only'] });
  assert.equal(parseModelRules({}), undefined);
  assert.equal(parseModelRules(null), undefined);
  assert.equal(parseModelRules({ allowlist: [] }), undefined, 'empty list ⇒ no rules');
  assert.equal(parseModelRules({ allowlist: 'nope' }), undefined);
});
