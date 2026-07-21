import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RollbackCandidate } from '../src/lib/rollback-policy.ts';
import {
  VERSION_LABEL_MAX,
  contractRows,
  diffSnapshots,
  manualRollbackNote,
  pickVersionTarget,
  validateVersionLabel,
} from '../src/lib/pipeline-version.ts';

// PURE unit tests for the version-management rules: label validation, contract diff, and the
// targeted-rollback selector. Exhaustive over the branches so the coverage bar is met on real logic.

// ─── validateVersionLabel ───────────────────────────────────────────────────────────────────────────

test('validateVersionLabel: undefined/null clear the label (valid)', () => {
  assert.deepEqual(validateVersionLabel(undefined), { ok: true, value: '' });
  assert.deepEqual(validateVersionLabel(null), { ok: true, value: '' });
});

test('validateVersionLabel: trims and accepts a normal label', () => {
  assert.deepEqual(validateVersionLabel('  RBI-approved v2  '), { ok: true, value: 'RBI-approved v2' });
});

test('validateVersionLabel: whitespace-only clears (valid, empty)', () => {
  assert.deepEqual(validateVersionLabel('   '), { ok: true, value: '' });
});

test('validateVersionLabel: rejects a non-string', () => {
  const r = validateVersionLabel(42);
  assert.equal(r.ok, false);
  assert.match(r.error!, /string/);
});

test('validateVersionLabel: rejects over the length cap', () => {
  const r = validateVersionLabel('x'.repeat(VERSION_LABEL_MAX + 1));
  assert.equal(r.ok, false);
  assert.match(r.error!, /characters or fewer/);
  // exactly at the cap is fine
  assert.equal(validateVersionLabel('y'.repeat(VERSION_LABEL_MAX)).ok, true);
});

// ─── diffSnapshots ────────────────────────────────────────────────────────────────────────────────

const baseSnap = {
  name: 'ABSLI Claims Triage',
  description: 'Life-insurance claims',
  visibility: 'org',
  status: 'published',
  gatewayId: 'gw_onprem',
  defaultModel: 'llama-3.1-8b',
  routing: { egressAllowed: false, rules: [{ name: 'r1' }] },
  dataAllowlist: ['pan-domain', 'ifsc-domain'],
  policyOverlay: { requirePiiMasking: {} },
  guardrailOverlay: {},
  isTemplate: false,
};

test('diffSnapshots: identical snapshots ⇒ all unchanged, changedCount 0', () => {
  const d = diffSnapshots(baseSnap, { ...baseSnap });
  assert.equal(d.changedCount, 0);
  assert.ok(d.changes.every((c) => c.kind === 'unchanged'));
});

test('diffSnapshots: a scalar change is reported as changed with from/to', () => {
  const d = diffSnapshots(baseSnap, { ...baseSnap, gatewayId: 'gw_cloud' });
  const gw = d.changes.find((c) => c.field === 'gatewayId')!;
  assert.equal(gw.kind, 'changed');
  assert.equal(gw.from, 'gw_onprem');
  assert.equal(gw.to, 'gw_cloud');
  assert.equal(d.changedCount, 1);
});

test('diffSnapshots: added (from absent) and removed (to absent)', () => {
  const added = diffSnapshots({ ...baseSnap, defaultModel: '' }, baseSnap);
  assert.equal(added.changes.find((c) => c.field === 'defaultModel')!.kind, 'added');
  const removed = diffSnapshots(baseSnap, { ...baseSnap, defaultModel: '' });
  assert.equal(removed.changes.find((c) => c.field === 'defaultModel')!.kind, 'removed');
});

test('diffSnapshots: data ceiling is order-insensitive but membership-sensitive', () => {
  const reordered = diffSnapshots(baseSnap, { ...baseSnap, dataAllowlist: ['ifsc-domain', 'pan-domain'] });
  assert.equal(reordered.changes.find((c) => c.field === 'dataAllowlist')!.kind, 'unchanged');
  const widened = diffSnapshots(baseSnap, {
    ...baseSnap,
    dataAllowlist: ['pan-domain', 'ifsc-domain', 'aadhaar-domain'],
  });
  assert.equal(widened.changes.find((c) => c.field === 'dataAllowlist')!.kind, 'changed');
});

test('diffSnapshots: routing summarises egress + rule count', () => {
  const d = diffSnapshots(baseSnap, { ...baseSnap, routing: { egressAllowed: true, rules: [] } });
  const r = d.changes.find((c) => c.field === 'routing')!;
  assert.equal(r.kind, 'changed');
  assert.match(r.from, /egress OFF · 1 rule/);
  assert.match(r.to, /egress ON · 0 rule/);
});

test('diffSnapshots: overlay diff is by sorted key set', () => {
  const d = diffSnapshots(baseSnap, {
    ...baseSnap,
    guardrailOverlay: { toxicity: {}, pii: {} },
  });
  const g = d.changes.find((c) => c.field === 'guardrailOverlay')!;
  assert.equal(g.kind, 'added'); // from was '—' (empty)
  assert.equal(g.to, 'pii, toxicity');
});

test('diffSnapshots: tolerates null/partial/legacy snapshots without throwing', () => {
  const d = diffSnapshots(null, { name: 'only-name' });
  assert.equal(d.changes.find((c) => c.field === 'name')!.kind, 'added');
  assert.equal(d.changes.find((c) => c.field === 'gatewayId')!.kind, 'unchanged'); // both absent
});

test('contractRows: renders the full ordered contract for one snapshot', () => {
  const rows = contractRows(baseSnap);
  assert.equal(rows.length, 11);
  assert.equal(rows.find((r) => r.field === 'dataAllowlist')!.value, 'ifsc-domain, pan-domain');
  assert.equal(rows.find((r) => r.field === 'routing')!.value, 'egress OFF · 1 rule(s)');
  // robust to nullish input
  assert.equal(contractRows(undefined).length, 11);
});

// ─── pickVersionTarget ──────────────────────────────────────────────────────────────────────────────

const history: RollbackCandidate[] = [
  { version: 1, note: 'created', snapshot: { status: 'draft', name: 'v1' } },
  { version: 2, note: 'published', snapshot: { status: 'published', name: 'v2' } },
  { version: 3, note: 'edited', snapshot: { status: 'published', name: 'v3' } },
];

test('pickVersionTarget: picks a valid prior version (honours operator choice)', () => {
  const r = pickVersionTarget(2, 3, history);
  assert.equal(r.ok, true);
  assert.equal(r.target!.version, 2);
  assert.equal((r.target!.snapshot as { name?: string }).name, 'v2');
});

test('pickVersionTarget: a draft version is still selectable if the operator chooses it', () => {
  // Unlike the auto last-good picker, the targeted picker does not require published — the operator
  // explicitly chose it and confirms with a reason.
  assert.equal(pickVersionTarget(1, 3, history).ok, true);
});

test('pickVersionTarget: rejects current/newer version', () => {
  assert.equal(pickVersionTarget(3, 3, history).ok, false);
  assert.match(pickVersionTarget(4, 3, history).reason!, /not older/);
});

test('pickVersionTarget: rejects a non-integer / non-positive version', () => {
  assert.equal(pickVersionTarget(0, 3, history).ok, false);
  assert.equal(pickVersionTarget(1.5, 3, history).ok, false);
});

test('pickVersionTarget: rejects an unknown version', () => {
  const r = pickVersionTarget(2, 5, [{ version: 4, note: 'edited', snapshot: { status: 'draft' } }]);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /no version v2/);
});

test('pickVersionTarget: rejects a version with no snapshot', () => {
  const bad: RollbackCandidate[] = [{ version: 1, note: 'x', snapshot: null as unknown as RollbackCandidate['snapshot'] }];
  const r = pickVersionTarget(1, 2, bad);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /no restorable snapshot/);
});

// ─── manualRollbackNote ───────────────────────────────────────────────────────────────────────────

test('manualRollbackNote: with and without detail', () => {
  assert.equal(manualRollbackNote(5, 2), 'Rollback (manual): v5 → restored v2');
  assert.equal(
    manualRollbackNote(5, 2, '  regression in masking  '),
    'Rollback (manual): v5 → restored v2 — regression in masking',
  );
  // whitespace-only detail is dropped
  assert.equal(manualRollbackNote(5, 2, '   '), 'Rollback (manual): v5 → restored v2');
});
