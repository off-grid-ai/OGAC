import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makePrng, seedFromString } from '../src/lib/demo/prng.ts';
import {
  BANK_FLAVOUR,
  INSURER_FLAVOUR,
  buildRunCorpus,
  flavourProfile,
  rollupCorpus,
} from '../src/lib/demo/telemetry.ts';
import { BHARAT_PROFILE, SURAKSHA_PROFILE, totalRuns } from '../src/lib/tour-demo-seed.ts';

// PURE unit tests for the demo telemetry generator — no DB, no network. They pin DETERMINISM (a
// re-run reproduces identical numbers → the seed is idempotent), the 30-day timestamp spread, the
// outcome/verdict distribution, and that BANK vs INSURER read as two different books. Real functions.

// ─── PRNG determinism ──────────────────────────────────────────────────────────
test('seedFromString is deterministic and a uint32', () => {
  const a = seedFromString('org_bharat:metric:kyc-rekyc:0');
  const b = seedFromString('org_bharat:metric:kyc-rekyc:0');
  assert.equal(a, b);
  assert.ok(a >= 0 && a <= 0xffffffff);
  assert.notEqual(a, seedFromString('org_bharat:metric:kyc-rekyc:1'));
});

test('makePrng yields the SAME sequence for the same seed and differs for another', () => {
  const p1 = makePrng('seed-x');
  const p2 = makePrng('seed-x');
  const s1 = [p1.next(), p1.next(), p1.next()];
  const s2 = [p2.next(), p2.next(), p2.next()];
  assert.deepEqual(s1, s2, 'same seed ⇒ identical stream');
  const p3 = makePrng('seed-y');
  assert.notDeepEqual([p3.next(), p3.next(), p3.next()], s1);
});

test('prng int/float/chance/pick stay within bounds', () => {
  const p = makePrng('bounds');
  for (let i = 0; i < 200; i++) {
    const n = p.int(3, 9);
    assert.ok(n >= 3 && n <= 9 && Number.isInteger(n));
    const f = p.float(1, 2);
    assert.ok(f >= 1 && f < 2);
    assert.equal(typeof p.chance(0.5), 'boolean');
  }
  assert.equal(p.chance(1), true, 'p=1 always true');
  assert.equal(p.chance(0), false, 'p=0 always false');
  const picked = p.pick(['a', 'b', 'c'] as const);
  assert.ok(['a', 'b', 'c'].includes(picked));
});

// ─── flavour profiles differ ─────────────────────────────────────────────────────
test('flavourProfile returns the bank profile for a bank and insurer for an insurer', () => {
  assert.equal(flavourProfile(BHARAT_PROFILE), BANK_FLAVOUR);
  assert.equal(flavourProfile(SURAKSHA_PROFILE), INSURER_FLAVOUR);
});

test('the insurer costs more per 1k tokens and runs heavier than the bank', () => {
  assert.ok(INSURER_FLAVOUR.usdPer1k > BANK_FLAVOUR.usdPer1k, 'insurer pricier per token');
  assert.ok(
    INSURER_FLAVOUR.promptTokens[1] > BANK_FLAVOUR.promptTokens[1],
    'insurer heavier prompts',
  );
});

// ─── corpus determinism + shape ────────────────────────────────────────────────
const NOW = Date.UTC(2026, 6, 10); // fixed reference so timestamps are stable in tests.

test('buildRunCorpus is deterministic — same inputs reproduce identical rows', () => {
  const a = buildRunCorpus(BHARAT_PROFILE, NOW, 30);
  const b = buildRunCorpus(BHARAT_PROFILE, NOW, 30);
  assert.deepEqual(
    a.map((m) => ({ ...m, totalTokens: m.totalTokens })),
    b.map((m) => ({ ...m, totalTokens: m.totalTokens })),
    'idempotent: a re-run yields the same corpus',
  );
});

test('the corpus size equals the tenant total run count from tour-demo-seed', () => {
  assert.equal(buildRunCorpus(BHARAT_PROFILE, NOW).length, totalRuns(BHARAT_PROFILE));
  assert.equal(buildRunCorpus(SURAKSHA_PROFILE, NOW).length, totalRuns(SURAKSHA_PROFILE));
});

test('every run has a unique deterministic id and a totalTokens = prompt + completion', () => {
  const corpus = buildRunCorpus(BHARAT_PROFILE, NOW);
  const ids = new Set(corpus.map((m) => m.id));
  assert.equal(ids.size, corpus.length, 'ids are unique');
  for (const m of corpus) {
    assert.equal(m.totalTokens, m.promptTokens + m.completionTokens);
    assert.ok(m.costUsd > 0, 'cost is positive');
    assert.ok(m.evalScore >= 0 && m.evalScore <= 100);
  }
});

test('timestamps sit within the trailing window and never in the future', () => {
  const windowDays = 30;
  const corpus = buildRunCorpus(SURAKSHA_PROFILE, NOW, windowDays);
  const earliest = NOW - (windowDays + 2) * 24 * 60 * 60 * 1000; // window + a day of jitter slack.
  for (const m of corpus) {
    const t = Date.parse(m.ts);
    assert.ok(t <= NOW, `${m.ts} must not be in the future`);
    assert.ok(t >= earliest, `${m.ts} must be within the window`);
  }
});

test('a blocked outcome always corresponds to a blocked guardrail verdict', () => {
  for (const profile of [BHARAT_PROFILE, SURAKSHA_PROFILE]) {
    for (const m of buildRunCorpus(profile, NOW)) {
      if (m.outcome === 'blocked') assert.equal(m.guardrailVerdict, 'blocked');
      if (m.guardrailVerdict !== 'blocked') assert.equal(m.outcome, 'ok');
    }
  }
});

test('a governed corpus shows a realistic mix — some blocked, some redacted, most ok', () => {
  const roll = rollupCorpus(buildRunCorpus(BHARAT_PROFILE, NOW));
  assert.ok(roll.runs > 20, 'a meaningful body of runs');
  assert.ok(roll.blocked >= 1, 'at least one blocked run so guardrails read as active');
  assert.ok(roll.redacted >= 1, 'at least one redacted run');
  assert.ok(roll.blocked < roll.runs / 2, 'most runs succeed');
  assert.ok(roll.avgEvalScore >= 70 && roll.avgEvalScore <= 100);
  assert.ok(roll.avgLatencyMs > 0);
});

test('bank vs insurer differ in volume and cost — two different books', () => {
  const bank = rollupCorpus(buildRunCorpus(BHARAT_PROFILE, NOW));
  const insurer = rollupCorpus(buildRunCorpus(SURAKSHA_PROFILE, NOW));
  assert.notEqual(bank.totalTokens, insurer.totalTokens);
  assert.notEqual(bank.totalCostUsd, insurer.totalCostUsd);
});

test('rollupCorpus on an empty corpus is all-zero (no divide-by-zero)', () => {
  const roll = rollupCorpus([]);
  assert.deepEqual(roll, {
    runs: 0,
    blocked: 0,
    redacted: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    avgLatencyMs: 0,
    avgEvalScore: 0,
  });
});
