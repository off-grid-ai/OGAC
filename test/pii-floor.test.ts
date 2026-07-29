import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { floorPass, isUnscreened, mergeFloor } from '../src/lib/pii-floor.ts';
import type { PiiResult } from '../src/lib/adapters/types.ts';

// ── G-F2 — the domestic-PII floor on the content-guardrail path ────────────────────────────────────
//
// LIVE FINDING (2026-07-29, against the deployed console). Scanning
//   `Ravi Kumar PAN ABCDE1234F, Aadhaar 2345 6789 0123, IFSC HDFC0001234, UPI ravi@okhdfc`
// returned entities `["PHONE_NUMBER"]` and redacted text
//   `Ravi Kumar PAN ABCDE1234F, Aadhaar [PHONE], IFSC HDFC0001234, UPI ravi@okhdfc`
// — PAN, IFSC and UPI undetected, Aadhaar mislabelled as a phone number — while the console displays
// a seeded policy reading "Mask PAN in every output".
//
// These tests exercise the REAL pure rules (no inlined copies, no mocked engine): the floor is the
// actual regex floor, and the merge is the actual composition the adapter calls.

const SAMPLE = 'Ravi Kumar PAN ABCDE1234F, Aadhaar 2345 6789 0123, IFSC HDFC0001234, UPI ravi@okhdfc';

/** A verdict shaped like a reachable engine that found nothing of its own. */
function cleanEngine(text: string): PiiResult {
  return { hits: false, entities: [], redacted: text, engine: 'llm-guard', status: 'applied' };
}

describe('G-F2 — the domestic floor detects what the engine missed', () => {
  test('PAN is masked and named — the policy the console displays is now true', () => {
    const floor = floorPass(SAMPLE);
    assert.ok(floor.entities.includes('IN_PAN'), `expected IN_PAN in ${JSON.stringify(floor.entities)}`);
    assert.ok(!floor.redacted.includes('ABCDE1234F'), 'the PAN must not survive in the text');
    assert.ok(floor.redacted.includes('[PAN]'));
  });

  test('IFSC and UPI are detected — both were completely missed live', () => {
    const floor = floorPass(SAMPLE);
    assert.ok(floor.entities.includes('IN_IFSC'));
    assert.ok(floor.entities.includes('UPI_ID'));
    assert.ok(!floor.redacted.includes('HDFC0001234'));
    assert.ok(!floor.redacted.includes('ravi@okhdfc'));
  });

  test('Aadhaar is labelled AADHAAR, not PHONE — the live mislabel is the regression to catch', () => {
    const floor = floorPass(SAMPLE);
    assert.ok(floor.entities.includes('IN_AADHAAR'));
    assert.ok(floor.redacted.includes('[AADHAAR]'));
    assert.ok(!floor.redacted.includes('[PHONE]'), 'Aadhaar must not be reported as a phone number');
    assert.ok(!floor.redacted.includes('2345 6789 0123'));
  });

  test('clean text stays untouched — the floor must not invent findings', () => {
    const floor = floorPass('The claim was approved within the remaining quota.');
    assert.deepEqual(floor.entities, []);
    assert.equal(floor.redacted, 'The claim was approved within the remaining quota.');
  });
});

describe('G-F2 — merging the floor into the engine verdict', () => {
  test("the union names both the floor's types and the engine's", () => {
    const floor = floorPass(SAMPLE);
    const merged = mergeFloor(floor, {
      ...cleanEngine(floor.redacted),
      hits: true,
      entities: ['Toxicity'],
    });
    assert.ok(merged.entities.includes('IN_PAN'));
    assert.ok(merged.entities.includes('Toxicity'), "the engine's own findings must survive");
    assert.equal(merged.hits, true);
  });

  test('a floor finding alone raises hits on an otherwise-clean engine pass', () => {
    const floor = floorPass(SAMPLE);
    const merged = mergeFloor(floor, cleanEngine(floor.redacted));
    assert.equal(merged.hits, true, 'domestic PII is a hit even when the engine found nothing');
  });

  test('entities are de-duplicated when both passes name the same type', () => {
    const floor = floorPass(SAMPLE);
    const merged = mergeFloor(floor, { ...cleanEngine(floor.redacted), entities: ['IN_PAN'] });
    assert.equal(merged.entities.filter((e) => e === 'IN_PAN').length, 1);
  });

  // ── The safety property. This is the reason the floor is a pre-pass and not a fallback. ──
  test('a BLOCKED engine stays blocked — the floor must never convert fail-closed into a pass', () => {
    const blocked: PiiResult = {
      hits: false,
      entities: [],
      engine: 'llm-guard',
      blocked: true,
      status: 'down',
      reason: 'engine unreachable',
    };
    const merged = mergeFloor(floorPass(SAMPLE), blocked);
    assert.equal(merged.blocked, true, 'a configured-but-unreachable engine must remain blocked');
    assert.deepEqual(merged.entities, [], 'a blocked verdict must not be dressed up with floor findings');
    assert.equal(merged.reason, 'engine unreachable');
  });

  test('an UNCONFIGURED engine is not upgraded to "screened" by the floor', () => {
    const unconfigured: PiiResult = {
      hits: false,
      entities: [],
      engine: 'llm-guard',
      configured: false,
      status: 'unconfigured',
    };
    const merged = mergeFloor(floorPass(SAMPLE), unconfigured);
    assert.equal(merged.configured, false);
    assert.equal(merged.status, 'unconfigured');
    assert.deepEqual(merged.entities, []);
  });

  test('isUnscreened identifies exactly the verdicts that must not be softened', () => {
    assert.equal(isUnscreened({ hits: false, entities: [], engine: 'x', blocked: true }), true);
    assert.equal(isUnscreened({ hits: false, entities: [], engine: 'x', configured: false }), true);
    assert.equal(isUnscreened(cleanEngine('t')), false);
  });

  test("the engine's shard coverage and status survive the merge", () => {
    const floor = floorPass(SAMPLE);
    const merged = mergeFloor(floor, {
      ...cleanEngine(floor.redacted),
      answeredBy: ['shard-a'],
      degraded: ['shard-b'],
    });
    assert.deepEqual(merged.answeredBy, ['shard-a']);
    assert.deepEqual(merged.degraded, ['shard-b']);
    assert.equal(merged.status, 'applied');
    assert.equal(merged.engine, 'llm-guard');
  });
});
