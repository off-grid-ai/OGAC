import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateRetention,
  normalizeRetentionAction,
} from '../src/lib/data-retention.ts';
import { resolveRtbfScope, type RtbfAsset } from '../src/lib/data-rtbf.ts';

const NOW = new Date('2026-07-04T00:00:00Z');

// ─── data-retention: every RetentionState branch ─────────────────────────────
test('normalizeRetentionAction maps known actions and falls back to delete', () => {
  assert.equal(normalizeRetentionAction('anonymize'), 'anonymize');
  assert.equal(normalizeRetentionAction('ARCHIVE'), 'archive');
  assert.equal(normalizeRetentionAction('nonsense'), 'delete');
  assert.equal(normalizeRetentionAction(null), 'delete');
});

test('legal hold → held, never purged (precedence over everything)', () => {
  const r = evaluateRetention({ retainDays: 30, legalHold: true, anchorAt: '2020-01-01' }, NOW);
  assert.equal(r.state, 'held');
  assert.equal(r.dueForDisposal, false);
  assert.equal(r.daysRemaining, null);
});

test('no retain window → indefinite', () => {
  const r = evaluateRetention({ retainDays: null, anchorAt: '2020-01-01' }, NOW);
  assert.equal(r.state, 'indefinite');
  assert.equal(r.retainDays, null);
  // retainDays 0 is also indefinite
  assert.equal(evaluateRetention({ retainDays: 0, anchorAt: '2020-01-01' }, NOW).state, 'indefinite');
});

test('window set but no anchor date → unknown', () => {
  const r = evaluateRetention({ retainDays: 30, anchorAt: null }, NOW);
  assert.equal(r.state, 'unknown');
  assert.equal(r.daysRemaining, null);
  // invalid date string is also no-anchor
  assert.equal(evaluateRetention({ retainDays: 30, anchorAt: 'not-a-date' }, NOW).state, 'unknown');
});

test('past its window → due for disposal (daysRemaining <= 0)', () => {
  const r = evaluateRetention({ retainDays: 10, anchorAt: '2026-06-01T00:00:00Z' }, NOW);
  assert.equal(r.state, 'due');
  assert.equal(r.dueForDisposal, true);
  assert.ok((r.daysRemaining ?? 0) <= 0);
});

test('within its window → active with positive daysRemaining', () => {
  const r = evaluateRetention({ retainDays: 365, anchorAt: '2026-06-01T00:00:00Z' }, NOW);
  assert.equal(r.state, 'active');
  assert.equal(r.dueForDisposal, false);
  assert.ok((r.daysRemaining ?? 0) > 0);
});

// ─── data-rtbf: cross-plane scope ─────────────────────────────────────────────
const piiAsset = (over: Partial<RtbfAsset> = {}): RtbfAsset => ({
  id: 'a1',
  name: 'customers',
  source: 'clickhouse',
  hasPii: true,
  piiTags: ['name', 'email'],
  ...over,
});

test('empty subject → empty scope', () => {
  const scope = resolveRtbfScope('', [piiAsset()]);
  assert.equal(scope.subject, '');
  assert.equal(scope.targets.length, 0);
  assert.equal(scope.immediateCount, 0);
  assert.equal(scope.deferredCount, 0);
  // whitespace-only is also empty
  assert.equal(resolveRtbfScope('   ', [piiAsset()]).targets.length, 0);
});

test('PII assets land in scope as deferred warehouse targets; non-PII are skipped', () => {
  const scope = resolveRtbfScope('alice@example.com', [
    piiAsset({ id: 'a1', piiTags: ['name'] }),
    piiAsset({ id: 'a2', hasPii: false, piiTags: [] }), // skipped
    piiAsset({ id: 'a3', piiTags: [] }), // PII but no tags → the no-tags detail arm
  ]);
  const warehouse = scope.targets.filter((t) => t.plane === 'warehouse');
  assert.equal(warehouse.length, 2, 'a1 and a3 in scope, a2 skipped');
  assert.ok(warehouse.every((t) => t.execution === 'deferred'));
  // tagged asset names its PII tags; untagged does not
  assert.match(warehouse.find((t) => t.ref === 'a1')!.detail, /PII \[name\]/);
  assert.doesNotMatch(warehouse.find((t) => t.ref === 'a3')!.detail, /PII \[/);
  // console-plane targets are immediate
  assert.ok(scope.immediateCount >= 1);
  assert.ok(scope.deferredCount >= 2);
});
