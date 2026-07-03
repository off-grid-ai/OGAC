import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeDecision,
  normalizeDecisions,
  type RawPolicyRecord,
} from '../src/lib/policy-view.ts';

test('normalizes an OPA-shaped allow decision', () => {
  const rec: RawPolicyRecord = {
    decision_id: 'abc-123',
    path: 'offgrid/authz',
    input: { role: 'admin', resource: 'secrets' },
    result: { allow: true },
    timestamp: '2026-07-01T10:00:00Z',
  };
  const row = normalizeDecision(rec);
  assert.equal(row.id, 'abc-123');
  assert.equal(row.allow, true);
  assert.equal(row.decision, 'allow');
  assert.equal(row.path, 'offgrid/authz');
  assert.equal(row.timestamp, '2026-07-01T10:00:00.000Z');
  // input summary is sorted key=value
  assert.equal(row.input, 'resource=secrets, role=admin');
  assert.equal(row.engine, 'opa');
});

test('normalizes a deny decision', () => {
  const row = normalizeDecision({ id: 'd1', result: { allow: false }, input: { role: 'viewer' } });
  assert.equal(row.allow, false);
  assert.equal(row.decision, 'deny');
});

test('accepts the console PolicyDecision shape (allow + engine + reason)', () => {
  const row = normalizeDecision({
    id: 'p1',
    allow: true,
    engine: 'abac',
    reason: '1 rule matched',
    resource: 'gateway',
  });
  assert.equal(row.allow, true);
  assert.equal(row.engine, 'abac');
  assert.equal(row.path, 'gateway'); // falls back to resource for the path label
});

test('reads string allow/deny signals', () => {
  assert.equal(normalizeDecision({ decision: 'deny' }).allow, false);
  assert.equal(normalizeDecision({ decision: 'allow' }).allow, true);
  assert.equal(normalizeDecision({ result: 'true' }).allow, true);
});

test('malformed / empty records default-deny safely', () => {
  const empty = normalizeDecision({}, 4);
  assert.equal(empty.allow, false); // default deny
  assert.equal(empty.decision, 'deny');
  assert.equal(empty.id, 'decision-4'); // synthesized from index
  assert.equal(empty.path, '');
  assert.equal(empty.input, '—');
  assert.equal(empty.timestamp, ''); // no timestamp
});

test('unparseable timestamp yields empty string, not NaN date', () => {
  const row = normalizeDecision({ id: 'x', timestamp: 'not-a-date' });
  assert.equal(row.timestamp, '');
});

test('normalizeDecisions maps a batch and rejects non-arrays', () => {
  const rows = normalizeDecisions([{ allow: true }, { allow: false }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].allow, true);
  assert.equal(rows[1].allow, false);
  // synthesized ids are index-based and unique
  assert.notEqual(rows[0].id, rows[1].id);

  assert.deepEqual(normalizeDecisions(null), []);
  assert.deepEqual(normalizeDecisions(undefined), []);
  assert.deepEqual(normalizeDecisions({}), []);
});

test('null entries inside the array degrade to a default-deny row', () => {
  const rows = normalizeDecisions([null]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].allow, false);
});
