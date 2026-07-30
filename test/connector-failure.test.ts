import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  type ConnectorFailure,
  connectorFailureMessage,
  connectorFailureSentence,
  connectorReadSentence,
  describeThrown,
} from '../src/lib/connector-failure.ts';
import { stepKindChip } from '../src/lib/app-run-progress.ts';

// ── What a person reads on a data-read step ─────────────────────────────────────────────────────────
//
// Two audiences share this path and they need different strings. The AUDIT line names the connector,
// the domain id and the driver; the SCREEN must not. Both governing rules are pinned here: a failed
// read may never read as emptiness, and our engineering vocabulary may never reach a screen.

const KINDS: ConnectorFailure['kind'][] = [
  'no-dialect',
  'unsafe-resource',
  'credential',
  'connection',
  'missing-binding',
  'source-refused',
];

describe('connectorFailureMessage', () => {
  test('THE governing rule: a failure never reads as emptiness', () => {
    // "No rows returned" on a refused connection is how a 500-row table became "this employee has no
    // reimbursement quota" and the claim was declined.
    for (const kind of KINDS) {
      const m = connectorFailureMessage('reimbursement quota', 'employee_quota', { kind });
      assert.match(m, /Could not read/, kind);
      assert.ok(!/no rows/i.test(m), `${kind} must not read as emptiness: ${m}`);
      assert.match(m, /No decision was made on unread data/, kind);
    }
  });

  test('names the source so the reader knows what is missing', () => {
    const m = connectorFailureMessage('reimbursement quota', 'employee_quota', { kind: 'credential' });
    assert.match(m, /reimbursement quota/);
    assert.match(m, /employee_quota/);
  });

  test('every kind has its own sentence — no silent fallback to a generic one', () => {
    const sentences = new Set(KINDS.map((kind) => connectorFailureSentence({ kind })));
    assert.equal(sentences.size, KINDS.length, 'each failure kind must be distinguishable');
  });

  test('an operator detail is appended when present, and omitted when blank', () => {
    assert.match(connectorFailureSentence({ kind: 'connection', detail: 'ECONNREFUSED' }), /ECONNREFUSED/);
    const bare = connectorFailureSentence({ kind: 'connection', detail: '   ' });
    assert.ok(!bare.includes('()'), bare);
  });
});

describe('describeThrown', () => {
  test('prefers the cause code — the fact that tells an operator what to fix', () => {
    assert.equal(describeThrown({ cause: { code: 'ECONNREFUSED' }, message: 'connect failed' }), 'ECONNREFUSED');
    assert.equal(describeThrown({ code: 'ER_ACCESS_DENIED_ERROR' }), 'ER_ACCESS_DENIED_ERROR');
  });

  test('falls back to the message, truncated so a driver cannot smuggle a query out', () => {
    const leak = `SELECT * FROM claims WHERE pan='ABCDE1234F' ${'x'.repeat(400)}`;
    const out = describeThrown(new Error(leak));
    assert.ok(out && out.length <= 120, `got ${out?.length}`);
  });

  test('nothing usable yields undefined rather than a misleading string', () => {
    assert.equal(describeThrown(null), undefined);
    assert.equal(describeThrown({}), undefined);
    assert.equal(describeThrown({ message: '   ' }), undefined);
  });
});

describe('connectorReadSentence', () => {
  test('reads as plain language, with no engineering vocabulary', () => {
    const s = connectorReadSentence('reimbursement quota', 6, ['employee_id']);
    // The live leak this replaced: data-domain "expense claims" [dom_7d17b157-0e6] → connector
    // con_f5c959 :: employee_quota (read) → ok(6 rows via mysql)
    for (const banned of ['data-domain', 'connector', 'mysql', 'postgres', 'dialect', 'dom_', 'con_']) {
      assert.ok(!s.toLowerCase().includes(banned), `"${banned}" must not be on screen: ${s}`);
    }
    assert.match(s, /reimbursement quota/);
    assert.match(s, /6 records/);
  });

  test('states the narrowing, so the reader knows whose records these are', () => {
    assert.match(connectorReadSentence('quota', 6, ['employee_id']), /narrowed to this case by employee_id/);
    assert.match(
      connectorReadSentence('quota', 2, ['claim_no', 'employee_id']),
      /claim_no and employee_id/,
    );
  });

  test('states the ABSENCE of narrowing — the reviewer must know other records are included', () => {
    // This is what a silent line would have hidden: 20 rows belonging to other employees.
    const s = connectorReadSentence('reimbursement quota', 20, []);
    assert.match(s, /not narrowed to this case/);
    assert.match(s, /other records are included/);
  });

  test('counts read naturally at one record', () => {
    assert.match(connectorReadSentence('expense claims', 1, ['claim_no']), /1 record\b/);
    assert.ok(!connectorReadSentence('expense claims', 1, ['claim_no']).includes('1 records'));
  });
});

describe('stepKindChip', () => {
  test('never puts a raw kind on screen', () => {
    // AppRunStatus rendered `step.kind`, so `connector-query` sat next to every read.
    assert.equal(stepKindChip('connector-query'), 'data');
    assert.equal(stepKindChip('agent'), 'reasoning');
    assert.equal(stepKindChip('human'), 'review');
    assert.equal(stepKindChip('guardrail'), 'safety');
    assert.equal(stepKindChip('output'), 'send');
    assert.equal(stepKindChip('action'), 'action');
  });

  test('an unknown kind degrades to readable words, not a hyphenated token', () => {
    assert.equal(stepKindChip('some-future-kind'), 'some future kind');
  });
});
