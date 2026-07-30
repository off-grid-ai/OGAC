import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { type AssessableStep, assessReview, caseAmount } from '../src/lib/review-risk.ts';

// ── Flow 6: "Reviewer sees risk and confidence" ──────────────────────────────────────────────────────
//
// Nothing implemented this step. Both signals are LEVELS with concrete reasons, never a percentage —
// every input is a discrete fact about the run, and deriving "87% confident" from those would invent
// precision, which is what the "Honest product state" non-negotiable forbids.

const read = (over: Partial<AssessableStep> = {}): AssessableStep => ({
  kind: 'connector-query',
  status: 'done',
  detail: 'Read 6 records from reimbursement quota, narrowed to this case by employee_id.',
  ...over,
});
const CASE = { claim_no: 'EXP-1', employee_id: 2, amount: '41346.44', status: 'submitted' };

describe('caseAmount', () => {
  test('finds the money in the case record, however it is spelled', () => {
    assert.equal(caseAmount({ amount: '41346.44' }), 41346.44);
    assert.equal(caseAmount({ claim_amount: 500 }), 500);
    assert.equal(caseAmount({ totalValue: '1,200.50' }), 1200.5);
    assert.equal(caseAmount({ premium: 9000 }), 9000);
  });

  test('does not mistake an identifier or a count for money', () => {
    assert.equal(caseAmount({ employee_id: 2, status: 'submitted' }), null);
    assert.equal(caseAmount({}), null);
    assert.equal(caseAmount(null), null);
  });
});

describe('assessReview — risk', () => {
  test('a pending send is riskier than a decision that is only recorded', () => {
    const willSend = assessReview(
      [read(), { kind: 'output', status: 'queued', label: 'Email the employee' }],
      CASE,
    );
    assert.equal(willSend.risk.level, 'medium');
    assert.match(willSend.risk.reasons[0], /Email the employee/);

    const recordOnly = assessReview([read()], CASE);
    assert.equal(recordOnly.risk.level, 'low');
    assert.match(recordOnly.risk.reasons[0], /recorded only/);
  });

  test('a high-value case raises risk and says why', () => {
    const a = assessReview([read(), { kind: 'output', status: 'queued' }], { amount: 250000 });
    assert.equal(a.risk.level, 'high');
    assert.ok(a.risk.reasons.some((r) => /250,000/.test(r)), JSON.stringify(a.risk.reasons));
    assert.ok(a.risk.reasons.some((r) => /high-value threshold/.test(r)));
  });

  test('the high-value threshold is the caller’s policy, not ours', () => {
    const steps = [read(), { kind: 'output', status: 'queued' } as AssessableStep];
    assert.equal(assessReview(steps, { amount: 50000 }, 10_000).risk.level, 'high');
    assert.equal(assessReview(steps, { amount: 50000 }, 1_000_000).risk.level, 'medium');
  });

  test('shadow mode lowers risk, because nothing is actually delivered', () => {
    const a = assessReview(
      [read(), { kind: 'output', status: 'done', wouldPerform: { sink: 'email' } }],
      { amount: 250000 },
    );
    assert.equal(a.risk.level, 'low');
    assert.ok(a.risk.reasons.some((r) => /shadow mode/i.test(r)));
  });

  test('amounts are stated without an invented currency symbol', () => {
    const a = assessReview([read()], { amount: '41346.44' });
    const joined = a.risk.reasons.join(' ');
    assert.match(joined, /41,346\.44/);
    assert.ok(!/[$₹€£]/.test(joined), joined);
  });
});

describe('assessReview — confidence', () => {
  test('all sources read and narrowed ⇒ high, and says so', () => {
    const a = assessReview([read(), read()], CASE);
    assert.equal(a.confidence.level, 'high');
    assert.match(a.confidence.reasons[0], /All 2 sources were read and narrowed to this case/);
  });

  test('an UNSCOPED read drops confidence and names the consequence', () => {
    // This is the defect that produced a useless decision live: other people's records in the evidence.
    const a = assessReview(
      [read(), read({ detail: 'Read 20 records from reimbursement quota — not narrowed to this case, so other records are included.' })],
      CASE,
    );
    assert.equal(a.confidence.level, 'medium');
    assert.ok(a.confidence.reasons.some((r) => /other records are included/.test(r)));
  });

  test('a failed step means part of the decision rests on unread data ⇒ low', () => {
    const a = assessReview([read(), read({ status: 'error' })], CASE);
    assert.equal(a.confidence.level, 'low');
    assert.ok(a.confidence.reasons.some((r) => /never read/.test(r)));
  });

  test('a hedging agent is surfaced — easy to miss inside a long answer ⇒ low', () => {
    const a = assessReview(
      [read(), { kind: 'agent', status: 'done', outcome: 'Not determinable — no valid quota data for the employee.' }],
      CASE,
    );
    assert.equal(a.confidence.level, 'low');
    assert.ok(a.confidence.reasons.some((r) => /could not determine/.test(r)));
  });

  test('no source data at all is called out rather than passing as clean', () => {
    const a = assessReview([{ kind: 'agent', status: 'done', outcome: 'Looks fine.' }], CASE);
    assert.equal(a.confidence.level, 'medium');
    assert.match(a.confidence.reasons[0], /No source data was read/);
  });

  test('a failure outranks an unscoped read — the worst fact decides the level', () => {
    const a = assessReview(
      [read({ status: 'error' }), read({ detail: 'Read 20 records — not narrowed to this case, so other records are included.' })],
      CASE,
    );
    assert.equal(a.confidence.level, 'low');
  });

  test('both signals always carry at least one reason — a bare level is not actionable', () => {
    for (const steps of [[], [read()], [read({ status: 'error' })]] as AssessableStep[][]) {
      const a = assessReview(steps, CASE);
      assert.ok(a.risk.reasons.length > 0, 'risk');
      assert.ok(a.confidence.reasons.length > 0, 'confidence');
    }
  });
});
