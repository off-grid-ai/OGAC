import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  pushCapped,
  toDecisionRow,
  recordDecision,
  recentDecisions,
  _resetDecisionLog,
  type DecisionRecordInput,
} from '../src/lib/policy-decision-log.ts';

// The first-party policy DECISION LOG — the read-back seam that makes the Policy/Control surface
// show real decision history without OPA's external sink. Pure ring + shaper are unit-tested; the
// module-state seam is integration-tested through record/read.

test('pushCapped: newest-first, capped at max', () => {
  let buf: number[] = [];
  for (let i = 0; i < 5; i++) buf = pushCapped(buf, i, 3);
  assert.deepEqual(buf, [4, 3, 2]); // newest first, oldest evicted
});

test('pushCapped: under the cap keeps everything, does not mutate input', () => {
  const a = [1, 2];
  const b = pushCapped(a, 3, 10);
  assert.deepEqual(b, [3, 1, 2]);
  assert.deepEqual(a, [1, 2]); // pure — original untouched
});

test('toDecisionRow: shapes an allow into the shared PolicyDecisionRow', () => {
  const rec: DecisionRecordInput = {
    allow: true,
    engine: 'abac',
    reason: '1 rule matched; allowed (deny-overrides)',
    role: 'analyst',
    resource: 'datasets',
    attributes: { department: 'tax', clearance: 'high' },
    ts: '2026-07-07T10:00:00Z',
    id: 'dec-1',
  };
  const row = toDecisionRow(rec, 1);
  assert.equal(row.id, 'dec-1');
  assert.equal(row.allow, true);
  assert.equal(row.decision, 'allow');
  assert.equal(row.engine, 'abac');
  assert.equal(row.path, 'datasets');
  assert.equal(row.timestamp, '2026-07-07T10:00:00Z');
  // input carries role + resource + sorted attrs + reason
  assert.match(row.input, /role=analyst/);
  assert.match(row.input, /resource=datasets/);
  assert.match(row.input, /clearance=high/);
  assert.match(row.input, /department=tax/);
  assert.match(row.input, /1 rule matched/);
});

test('toDecisionRow: deny + no attrs + synthesized id', () => {
  const row = toDecisionRow({ allow: false, engine: 'opa', reason: '', role: '', resource: '' }, 7);
  assert.equal(row.allow, false);
  assert.equal(row.decision, 'deny');
  assert.equal(row.id, 'abac-7');
  assert.equal(row.path, 'offgrid/authz'); // falls back when resource blank
  assert.match(row.input, /role=\*/);
  assert.match(row.input, /resource=\*/);
});

test('recordDecision + recentDecisions: real round-trip through the module seam', () => {
  _resetDecisionLog();
  assert.deepEqual(recentDecisions(), []);

  recordDecision({ allow: true, engine: 'abac', reason: 'ok', role: 'admin', resource: 'secrets' });
  recordDecision({ allow: false, engine: 'abac', reason: 'deny', role: 'viewer', resource: 'secrets' });

  const rows = recentDecisions();
  assert.equal(rows.length, 2);
  // newest-first
  assert.equal(rows[0].allow, false);
  assert.equal(rows[1].allow, true);
  // ids are unique + monotonic
  assert.notEqual(rows[0].id, rows[1].id);
});

test('recentDecisions: respects the limit', () => {
  _resetDecisionLog();
  for (let i = 0; i < 10; i++) {
    recordDecision({ allow: true, engine: 'abac', reason: '', role: 'r', resource: `res${i}` });
  }
  assert.equal(recentDecisions(3).length, 3);
  assert.equal(recentDecisions().length, 10);
  _resetDecisionLog();
});
