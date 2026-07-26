import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_QUALITY_GATE,
  normalizeQualityGate,
  qualityGateDecision,
  qualityGateEnabled,
} from '@/lib/etl-quality-gate';

// The rule that stops bad data reaching the warehouse. Before this, an ETL job wrote rows into
// ClickHouse with NO quality check in the path — a bad sync landed silently and every downstream
// answer inherited it. PURE: no I/O, every branch asserted.

const PASS = { success: true, passed: 5, total: 5, failed: 0, engineReachable: true };
const FAIL = { success: false, passed: 3, total: 5, failed: 2, engineReachable: true };
const DOWN = { success: false, passed: 0, total: 0, failed: 0, engineReachable: false };

test('normalizeQualityGate: unknown/garbage falls back to the safe default (off)', () => {
  assert.deepEqual(normalizeQualityGate(null), DEFAULT_QUALITY_GATE);
  assert.deepEqual(normalizeQualityGate({ mode: 'nonsense' }), { mode: 'off' });
  assert.equal(normalizeQualityGate({ mode: 'block' }).mode, 'block');
  assert.equal(normalizeQualityGate({ mode: 'warn' }).mode, 'warn');
  // suite is trimmed and dropped when blank; expectations pass through untouched
  assert.equal(normalizeQualityGate({ mode: 'warn', suite: '  s1 ' }).suite, 's1');
  assert.equal(normalizeQualityGate({ mode: 'warn', suite: '   ' }).suite, undefined);
  assert.deepEqual(normalizeQualityGate({ mode: 'warn', expectations: [{ a: 1 }] }).expectations, [{ a: 1 }]);
});

test('qualityGateEnabled: only warn/block run a checkpoint', () => {
  assert.equal(qualityGateEnabled({ mode: 'off' }), false);
  assert.equal(qualityGateEnabled({ mode: 'warn' }), true);
  assert.equal(qualityGateEnabled({ mode: 'block' }), true);
});

test("mode 'off' never checks and never blocks (existing jobs are byte-identical)", () => {
  const o = qualityGateDecision({ mode: 'off' }, FAIL);
  assert.deepEqual({ block: o.block, checked: o.checked }, { block: false, checked: false });
});

test("mode 'block' BLOCKS the write on a failing verdict and says why", () => {
  const o = qualityGateDecision({ mode: 'block' }, FAIL);
  assert.equal(o.block, true);
  assert.equal(o.checked, true);
  assert.match(o.reason, /BLOCKED/);
  assert.match(o.reason, /3\/5 expectations passed, 2 failed/);
});

test("mode 'warn' records the same failure but lets the sync proceed", () => {
  const o = qualityGateDecision({ mode: 'warn' }, FAIL);
  assert.equal(o.block, false);
  assert.equal(o.checked, true);
  assert.match(o.reason, /warn/);
  assert.match(o.reason, /sync proceeded/);
});

test('a passing verdict never blocks, in either mode', () => {
  for (const mode of ['warn', 'block'] as const) {
    const o = qualityGateDecision({ mode }, PASS);
    assert.equal(o.block, false, mode);
    assert.equal(o.checked, true, mode);
    assert.match(o.reason, /passed — 5\/5/);
  }
});

test("FAIL-CLOSED: an unreachable engine blocks in 'block' mode — an unverifiable guarantee is none", () => {
  const o = qualityGateDecision({ mode: 'block' }, DOWN);
  assert.equal(o.block, true);
  assert.equal(o.checked, false, 'nothing was actually measured');
  assert.match(o.reason, /unreachable/);
  assert.match(o.reason, /fail-closed/);
});

test("...but the same outage only WARNS in 'warn' mode (it never promised enforcement)", () => {
  const o = qualityGateDecision({ mode: 'warn' }, DOWN);
  assert.equal(o.block, false);
  assert.match(o.reason, /unverified/);
});

test('a missing verdict is treated as unverifiable: block-mode blocks, warn-mode proceeds', () => {
  assert.equal(qualityGateDecision({ mode: 'block' }, null).block, true);
  assert.equal(qualityGateDecision({ mode: 'warn' }, null).block, false);
  assert.equal(qualityGateDecision({ mode: 'off' }, null).block, false);
});
