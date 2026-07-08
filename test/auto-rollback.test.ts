import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  shouldAutoRollbackOnDrift,
  shouldAutoRollbackOnGate,
} from '../src/lib/auto-rollback.ts';
import type { ReleaseGateDecision } from '../src/lib/release-gate.ts';

// Unit tests for the PURE auto-rollback trigger decisions. No I/O.

test('a DRIFT breach fires an auto-rollback', () => {
  const d = shouldAutoRollbackOnDrift('drift');
  assert.equal(d.fire, true);
  assert.equal(d.reason, 'drift-breach');
});

test('a drift WARNING does NOT fire (heads-up, not a regression)', () => {
  assert.equal(shouldAutoRollbackOnDrift('warning').fire, false);
  assert.equal(shouldAutoRollbackOnDrift('stable').fire, false);
});

const gate = (over: Partial<ReleaseGateDecision>): ReleaseGateDecision => ({
  pass: true,
  gated: false,
  failing: [],
  unscored: [],
  passed: 0,
  summary: '',
  ...over,
});

test('a GATED failing eval fires an auto-rollback and names the failures', () => {
  const decision = gate({
    pass: false,
    gated: true,
    failing: [{ evalId: 'e1', name: 'faithfulness', score: 40, thresholdPct: 90 }],
  });
  const d = shouldAutoRollbackOnGate(decision);
  assert.equal(d.fire, true);
  assert.equal(d.reason, 'eval-gate-fail');
  assert.match(d.detail, /faithfulness/);
});

test('a passing gate does NOT fire', () => {
  assert.equal(shouldAutoRollbackOnGate(gate({ pass: true, gated: true })).fire, false);
});

test('an UNGATED decision never fires (no verdict we could compute)', () => {
  // pass:false but gated:false shouldn't happen from the pure gate, but the trigger must be honest:
  // no scored failing eval ⇒ no rollback.
  const decision = gate({ pass: false, gated: false, failing: [] });
  assert.equal(shouldAutoRollbackOnGate(decision).fire, false);
});
