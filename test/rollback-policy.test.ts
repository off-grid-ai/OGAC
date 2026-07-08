import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  pickRollbackTarget,
  rollbackNote,
  type RollbackCandidate,
} from '../src/lib/rollback-policy.ts';

// Unit tests for the PURE rollback-target selection. No I/O.

const v = (version: number, status: string, note = status): RollbackCandidate => ({
  version,
  note,
  snapshot: { status, tag: `snap-${version}` },
});

test('picks the highest-versioned prior PUBLISHED version', () => {
  const history = [v(5, 'published'), v(4, 'edited'), v(3, 'published'), v(2, 'published')];
  const t = pickRollbackTarget(6, history);
  assert.notEqual(t, null);
  assert.equal(t?.version, 5);
});

test('skips versions newer than or equal to current (no rolling forward / no-op)', () => {
  const history = [v(7, 'published'), v(6, 'published'), v(5, 'published')];
  const t = pickRollbackTarget(6, history); // current is 6 → only v5 is a valid prior target
  assert.equal(t?.version, 5);
});

test('skips non-published (draft/edited) snapshots — never promotes a never-live version', () => {
  const history = [v(5, 'draft'), v(4, 'edited'), v(3, 'published')];
  const t = pickRollbackTarget(6, history);
  assert.equal(t?.version, 3);
});

test('returns null when there is NO prior published version (honest — cannot roll back)', () => {
  const history = [v(5, 'draft'), v(4, 'edited')];
  const t = pickRollbackTarget(6, history);
  assert.equal(t, null);
});

test('returns null on empty history', () => {
  assert.equal(pickRollbackTarget(2, []), null);
});

test('carries the target snapshot verbatim', () => {
  const history = [v(3, 'published')];
  const t = pickRollbackTarget(4, history);
  assert.equal((t?.snapshot as { tag?: string }).tag, 'snap-3');
});

test('a prior autorollback snapshot that is published-status is eligible', () => {
  const history = [
    { version: 4, note: 'auto-rollback (drift breach): v5 → restored v3', snapshot: { status: 'published' } },
    v(3, 'published'),
  ];
  const t = pickRollbackTarget(5, history);
  assert.equal(t?.version, 4);
});

test('rollbackNote is a short, human-readable audit line', () => {
  assert.match(rollbackNote('eval-gate-fail', 6, 3), /^Auto-rollback \(eval gate failed\): v6 → restored v3$/);
  assert.match(rollbackNote('drift-breach', 6, 3, 'score 0.4'), /drift breach detected.*score 0\.4/);
});
