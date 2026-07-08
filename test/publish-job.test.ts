import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isTerminal,
  nextStatus,
  resolveFromGate,
  type PublishJobStatus,
} from '@/lib/publish-job';
import type { ReleaseGateDecision } from '@/lib/release-gate';

// PURE unit tests for the async publish-gate state model (M1-a). No I/O — just the legal transitions
// and the gate→terminal mapping. Guards a double-resolve and the honest pass/fail/override branching.

function decision(pass: boolean): ReleaseGateDecision {
  return {
    pass,
    gated: true,
    failing: pass ? [] : [{ evalId: 'e1', name: 'faithfulness', score: 40, thresholdPct: 80 }],
    unscored: [],
    passed: pass ? 1 : 0,
    summary: pass ? 'ok' : 'failed',
  };
}

test('isTerminal — gating is live, published/blocked are frozen', () => {
  assert.equal(isTerminal('gating'), false);
  assert.equal(isTerminal('published'), true);
  assert.equal(isTerminal('blocked'), true);
});

test('nextStatus — a gating job may resolve; a terminal job is frozen', () => {
  assert.equal(nextStatus('gating', 'published'), 'published');
  assert.equal(nextStatus('gating', 'blocked'), 'blocked');
  // Already resolved — no transition allowed (guards a double-publish on a duplicate completion).
  for (const from of ['published', 'blocked'] as PublishJobStatus[]) {
    assert.equal(nextStatus(from, 'published'), null);
    assert.equal(nextStatus(from, 'blocked'), null);
  }
});

test('resolveFromGate — pass → published (not overridden)', () => {
  const r = resolveFromGate(decision(true), false);
  assert.deepEqual(r, { status: 'published', overridden: false });
});

test('resolveFromGate — fail + no override → blocked', () => {
  const r = resolveFromGate(decision(false), false);
  assert.deepEqual(r, { status: 'blocked', overridden: false });
});

test('resolveFromGate — fail + override → published (audited override)', () => {
  const r = resolveFromGate(decision(false), true);
  assert.deepEqual(r, { status: 'published', overridden: true });
});

test('resolveFromGate — override on a PASS does not falsely flag overridden', () => {
  // A passing gate ignores the override flag — it published cleanly, not via an override.
  const r = resolveFromGate(decision(true), true);
  assert.deepEqual(r, { status: 'published', overridden: false });
});
