import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  planPropagation,
  subjectKey,
  summarizePropagation,
  TARGET_LABELS,
  type NotConfigured,
  type PropagationResult,
} from '../src/lib/erasure-plan.ts';

// PURE unit tests for the DSAR external-plane PROPAGATION planner — no I/O, no mocks. Locks which
// targets run, in what order, keyed how, and that unconfigured targets are HONESTLY deferred (never
// counted erased).

test('subjectKey: trims and lower-cases; blank → empty', () => {
  assert.equal(subjectKey('  Alice@Corp.IN  '), 'alice@corp.in');
  assert.equal(subjectKey(''), '');
  assert.equal(subjectKey('   '), '');
  // @ts-expect-error deliberately nullish
  assert.equal(subjectKey(null), '');
});

test('planPropagation: all targets configured → a step each, in vector→lake→device order', () => {
  const plan = planPropagation('Bob@Corp.in', { vector: true, lake: true, device: true });
  assert.equal(plan.subject, 'bob@corp.in');
  assert.deepEqual(plan.steps.map((s) => s.target), ['vector', 'lake', 'device']);
  assert.equal(plan.notConfigured.length, 0);
  for (const step of plan.steps) {
    assert.equal(step.subjectKey, 'bob@corp.in'); // DRY subject-key derivation
    assert.equal(step.label, TARGET_LABELS[step.target]);
  }
});

test('planPropagation: unconfigured targets are deferred with a reason (not steps)', () => {
  const plan = planPropagation('carol@corp.in', { vector: false, lake: false, device: true });
  assert.deepEqual(plan.steps.map((s) => s.target), ['device']);
  const deferredTargets = plan.notConfigured.map((n) => n.target).sort();
  assert.deepEqual(deferredTargets, ['lake', 'vector']);
  for (const n of plan.notConfigured) {
    assert.ok(n.reason.length > 0, 'every deferred target carries a reason');
    assert.match(n.reason, /deferred|not configured/i);
  }
});

test('planPropagation: blank subject → no steps, every target deferred with blank-subject reason', () => {
  const plan = planPropagation('   ', { vector: true, lake: true, device: true });
  assert.equal(plan.subject, '');
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.notConfigured.length, 3);
  for (const n of plan.notConfigured) assert.match(n.reason, /blank subject/i);
});

test('planPropagation: device is driven purely by config (queue availability is the caller’s call)', () => {
  const off = planPropagation('dave@corp.in', { vector: true, lake: true, device: false });
  assert.ok(!off.steps.some((s) => s.target === 'device'));
  assert.ok(off.notConfigured.some((n) => n.target === 'device'));
});

test('summarizePropagation: erased → propagated; error/deferred → deferred; notConfigured merged in', () => {
  const executed: PropagationResult[] = [
    { target: 'vector', label: TARGET_LABELS.vector, outcome: 'erased', removed: 4, reason: null },
    { target: 'lake', label: TARGET_LABELS.lake, outcome: 'error', removed: 0, reason: 'lake down' },
  ];
  const notConfigured: NotConfigured[] = [
    { target: 'device', label: TARGET_LABELS.device, reason: 'no channel' },
  ];
  const report = summarizePropagation('Eve@Corp.in', executed, notConfigured);
  assert.equal(report.subject, 'eve@corp.in');
  assert.deepEqual(report.propagated.map((r) => r.target), ['vector']);
  assert.equal(report.propagated[0].removed, 4);
  // The errored lake AND the not-configured device both land in deferred — honest, never erased.
  const deferredTargets = report.deferred.map((r) => r.target).sort();
  assert.deepEqual(deferredTargets, ['device', 'lake']);
  // Honest: the errored lake keeps outcome 'error'; the plan-deferred device is 'deferred'. Neither
  // is 'erased' — that's the invariant (nothing in the deferred bucket was counted as propagated).
  assert.ok(report.deferred.every((r) => r.outcome !== 'erased'));
  assert.equal(report.deferred.find((r) => r.target === 'lake')?.outcome, 'error');
  assert.equal(report.deferred.find((r) => r.target === 'device')?.outcome, 'deferred');
  assert.ok(report.deferred.find((r) => r.target === 'device')?.reason === 'no channel');
});

test('summarizePropagation: nothing executed → all notConfigured deferred, none propagated', () => {
  const report = summarizePropagation('x@corp.in', [], [
    { target: 'vector', label: TARGET_LABELS.vector, reason: 'r1' },
    { target: 'lake', label: TARGET_LABELS.lake, reason: 'r2' },
    { target: 'device', label: TARGET_LABELS.device, reason: 'r3' },
  ]);
  assert.equal(report.propagated.length, 0);
  assert.equal(report.deferred.length, 3);
});
