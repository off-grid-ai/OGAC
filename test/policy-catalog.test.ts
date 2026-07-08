import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHECK_IDS } from '../src/lib/checks.ts';
import { MODEL_CATALOG } from '../src/lib/model-catalog.ts';
import {
  GUARDRAIL_OPTIONS,
  KNOWN_GUARDRAIL_IDS,
  isKnownGuardrail,
  isKnownModel,
  knownModelIds,
  modelOptions,
  sanitizeGuardrails,
  sanitizeModels,
} from '../src/lib/policy-catalog.ts';

// PURE unit tests for the org-policy value catalog (Task #173, T3). The PolicyEditor used to accept
// ANY free-typed garbage for guardrails + allowed-models and publish it org-wide. These lock in that
// only enforceable values are ever accepted — the core of the "no silently-broken governance" fix.

// ─── Guardrails: derived from the REAL runtime check registry ─────────────────────────────────────

test('KNOWN_GUARDRAIL_IDS is exactly the runtime check registry ids', () => {
  assert.deepEqual([...KNOWN_GUARDRAIL_IDS], [...CHECK_IDS]);
  // The checks that actually run today.
  assert.ok(CHECK_IDS.includes('pii'));
  assert.ok(CHECK_IDS.includes('injection'));
  assert.ok(CHECK_IDS.includes('grounding'));
});

test('GUARDRAIL_OPTIONS has one option per real check id, each with a friendly label', () => {
  assert.equal(GUARDRAIL_OPTIONS.length, CHECK_IDS.length);
  for (const opt of GUARDRAIL_OPTIONS) {
    assert.ok(CHECK_IDS.includes(opt.id), `${opt.id} is a real check id`);
    assert.ok(opt.label.length > 0);
    assert.ok(opt.hint.length > 0);
  }
});

test('isKnownGuardrail accepts real check ids and rejects garbage', () => {
  assert.equal(isKnownGuardrail('pii'), true);
  assert.equal(isKnownGuardrail('injection'), true);
  assert.equal(isKnownGuardrail('grounding'), true);
  // trims + case-insensitive
  assert.equal(isKnownGuardrail('  PII  '), true);
  // the founder's bug: garbage must be rejected
  assert.equal(isKnownGuardrail('asasd'), false);
  assert.equal(isKnownGuardrail('pii-input'), false, 'a plausible-but-unregistered value is rejected');
  assert.equal(isKnownGuardrail(''), false);
});

test('sanitizeGuardrails keeps only real checks, de-dupes, drops garbage — the add-path guard', () => {
  const out = sanitizeGuardrails(['pii', 'asasd', 'PII', 'injection', '  ', 'not-a-check']);
  assert.deepEqual(out, ['pii', 'injection'], 'garbage + dupes dropped, order preserved');
});

// ─── Models: MODEL_CATALOG ∪ live fleet tags ──────────────────────────────────────────────────────

test('knownModelIds with no fleet tags is exactly the curated catalog', () => {
  const ids = knownModelIds([]);
  assert.deepEqual(ids.sort(), MODEL_CATALOG.map((m) => m.id).sort());
});

test('isKnownModel accepts catalog ids and rejects unknowns', () => {
  assert.equal(isKnownModel('gemma-4-e4b'), true, 'a fleet-served catalog id');
  assert.equal(isKnownModel('llama-3.1-8b-instruct'), true, 'a curated catalog id');
  assert.equal(isKnownModel('  QWEN3-VL-8B  '), true, 'trims + case-insensitive');
  assert.equal(isKnownModel('gpt-4o'), false, 'not in the catalog / not served → rejected');
  assert.equal(isKnownModel('totally-made-up-model'), false);
});

test('a live fleet tag with no catalog entry becomes a known, pickable model (union)', () => {
  const tags = ['some-new-fleet-model'];
  assert.equal(isKnownModel('some-new-fleet-model', tags), true);
  const opts = modelOptions(tags);
  const surfaced = opts.find((m) => m.id === 'some-new-fleet-model');
  assert.ok(surfaced, 'the live-only tag is surfaced as a pickable option');
  assert.equal(surfaced?.servedOnFleet, true);
});

test('modelOptions marks catalog entries served only when a live tag matches', () => {
  // With NO live tags, even a statically fleet-flagged entry is reported not-served (DB is truth).
  const none = modelOptions([]);
  assert.equal(none.find((m) => m.id === 'gemma-4-e4b')?.servedOnFleet, false);
  // With the tag present, it is served.
  const live = modelOptions(['gemma-4-e4b']);
  assert.equal(live.find((m) => m.id === 'gemma-4-e4b')?.servedOnFleet, true);
});

test('sanitizeModels keeps only known models (catalog ∪ fleet), de-dupes, drops garbage', () => {
  const out = sanitizeModels(
    ['gemma-4-e4b', 'gpt-4o', 'GEMMA-4-E4B', 'some-live-tag', 'garbage'],
    ['some-live-tag'],
  );
  assert.deepEqual(out, ['gemma-4-e4b', 'some-live-tag'], 'unknowns + dupes dropped, order kept');
});
