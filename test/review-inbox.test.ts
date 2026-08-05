import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  amountLabelFor,
  buildReviewDetail,
  canReviewerApprove,
  childRunIdForReview,
  decisionQuestion,
  faithfulnessPct,
  formatAmount,
  guardrailNotesFrom,
  humanizeKey,
  inputPairs,
  isReviewerFor,
  policyContextFrom,
  recommendationFrom,
  requestedByFor,
  scopeInbox,
  summarizeInboxItem,
  type ReviewAppLike,
  type ReviewAgentTrace,
} from '../src/lib/review-inbox.ts';
import type { AppAccessCaller, AppAccessPolicy } from '../src/lib/app-access-policy.ts';
import type { AppRunView, AppRunStepRow } from '../src/lib/app-runs-view.ts';

// PURE HITL review-inbox logic — scoping + plain-language presentation. Zero-IO; every branch here.

const ORG = 'org-a';

function policy(p: Partial<AppAccessPolicy> = {}): AppAccessPolicy {
  return { appId: 'app_1', orgId: ORG, ownerId: 'owner@corp', actions: {}, ...p };
}
function app(p: Partial<ReviewAppLike> = {}): ReviewAppLike {
  return { id: 'app_1', title: 'Reimbursement Approver', summary: 'Approves EMP reimbursements', ownerId: 'owner@corp', policy: policy(), ...p };
}
function caller(p: Partial<AppAccessCaller> = {}): AppAccessCaller {
  return { role: 'manager', department: null, orgId: ORG, userId: 'mgr@corp', ...p };
}
function step(p: Partial<AppRunStepRow> = {}): AppRunStepRow {
  return { id: 's1', kind: 'human', label: 'Manager approval', status: 'awaiting_human', ...p };
}
function run(p: Partial<AppRunView> = {}): AppRunView {
  return {
    id: 'apprun_1',
    appId: 'app_1',
    status: 'awaiting_human',
    input: {},
    steps: [step()],
    outcome: '',
    provenance: null,
    startedAt: '2026-07-04T10:00:00.000Z',
    finishedAt: null,
    ...p,
  };
}

// ─── formatAmount ────────────────────────────────────────────────────────────────────────────────────
// formatAmount is routed through money.ts, which is INR with Indian (lakh/crore) digit grouping — the
// product's default currency and market. This used to assert a hardcoded en-US "$500,000"; that was the
// stale expectation, not the code (money.ts predated this call site and already did the right thing —
// see the comment on formatAmount in review-inbox.ts). Renamed to describe what it actually checks now.
test('formatAmount: INR with Indian digit grouping for numbers + numeric strings, null otherwise', () => {
  assert.equal(formatAmount(500000), '₹5,00,000');
  assert.equal(formatAmount('500000'), '₹5,00,000');
  assert.equal(formatAmount('  '), null);
  assert.equal(formatAmount('abc'), null);
  assert.equal(formatAmount(undefined), null);
  assert.equal(formatAmount(null), null);
});

// ─── decisionQuestion ──────────────────────────────────────────────────────────────────────────────
test('decisionQuestion: amount + requester + subject fallbacks', () => {
  // ₹5,00,000 (Indian grouping), not the old $500,000 — see the formatAmount test above.
  assert.equal(
    decisionQuestion(app(), { amount: 500000, employeeId: 'EMP00001' }),
    'Approve ₹5,00,000 — Reimbursement Approver for EMP00001?',
  );
  // subject overrides app title as the noun; no amount.
  assert.equal(decisionQuestion(app(), { subject: 'Travel claim' }), 'Approve Travel claim?');
  // no amount, no requester, no subject → app title only.
  assert.equal(decisionQuestion(app(), {}), 'Approve Reimbursement Approver?');
});

// ─── amountLabelFor / requestedByFor ─────────────────────────────────────────────────────────────
test('amountLabelFor + requestedByFor read the priority keys', () => {
  // 12500000 grouped the Indian way is 1,25,00,000 (1 crore 25 lakh), not the western 12,500,000.
  assert.equal(amountLabelFor({ quote: 12500000 }), '₹1,25,00,000');
  assert.equal(amountLabelFor({}), null);
  assert.equal(requestedByFor({ requester: 'Asha' }), 'Asha');
  assert.equal(requestedByFor({ emp_id: 'EMP42' }), 'EMP42');
  assert.equal(requestedByFor({}), null);
});

// ─── canReviewerApprove — reuses evaluateApprovalAuthority ───────────────────────────────────────
test('canReviewerApprove: within + above threshold, and cross-org', () => {
  const a = app({
    policy: policy({ approval: { approverRoles: ['manager'], thresholdAttribute: 'amount', maxThreshold: 100000 } }),
  });
  assert.equal(canReviewerApprove(a, { amount: 90000 }, caller()).allow, true);
  const over = canReviewerApprove(a, { amount: 500000 }, caller());
  assert.equal(over.allow, false);
  assert.match(over.reason, /exceeds approver authority/);
  // wrong role.
  assert.equal(canReviewerApprove(a, { amount: 1 }, caller({ role: 'analyst' })).allow, false);
  // cross-org.
  const x = canReviewerApprove(a, { amount: 1 }, caller({ orgId: 'other' }));
  assert.equal(x.allow, false);
  assert.match(x.reason, /does not match/);
});

// ─── isReviewerFor — the WHO gate (broader than can-approve) ─────────────────────────────────────
test('isReviewerFor: owner, admin, approver role/user, approve allow-list, and denies', () => {
  assert.equal(isReviewerFor(app(), caller({ userId: 'owner@corp' })), true); // owner
  assert.equal(isReviewerFor(app(), caller({ role: 'admin' })), true); // admin
  assert.equal(
    isReviewerFor(app({ policy: policy({ approval: { approverRoles: ['manager'] } }) }), caller()),
    true,
  );
  assert.equal(
    isReviewerFor(app({ policy: policy({ approval: { approverUsers: ['mgr@corp'] } }) }), caller()),
    true,
  );
  assert.equal(
    isReviewerFor(app({ policy: policy({ actions: { approve: { roles: ['manager'] } } }) }), caller()),
    true,
  );
  assert.equal(
    isReviewerFor(app({ policy: policy({ actions: { approve: { roles: ['*'] } } }) }), caller({ role: 'x' })),
    true,
  );
  assert.equal(
    isReviewerFor(app({ policy: policy({ actions: { approve: { departments: ['claims'] } } }) }), caller({ department: 'claims' })),
    true,
  );
  // plain non-reviewer, cross-org.
  assert.equal(isReviewerFor(app(), caller({ role: 'analyst' })), false);
  assert.equal(isReviewerFor(app(), caller({ role: 'admin', orgId: 'other' })), false);
});

// ─── summarizeInboxItem + scopeInbox ─────────────────────────────────────────────────────────────
test('summarizeInboxItem: maps run+app to a scannable row with canApprove', () => {
  const a = app({ policy: policy({ approval: { approverRoles: ['manager'], thresholdAttribute: 'amount', maxThreshold: 100000 } }) });
  const item = summarizeInboxItem(run({ input: { amount: 90000, employeeId: 'EMP1' } }), a, caller());
  // ₹90,000 — INR, Indian grouping (unchanged from western at this magnitude, but still ₹ not $).
  assert.equal(item.amountLabel, '₹90,000');
  assert.equal(item.requestedBy, 'EMP1');
  assert.equal(item.stepLabel, 'Manager approval');
  assert.equal(item.canApprove, true);
});

test('scopeInbox: keeps only awaiting runs whose app the caller reviews, newest first', () => {
  const reviewable = app({ id: 'app_1', policy: policy({ appId: 'app_1', approval: { approverRoles: ['manager'] } }) });
  const notMine = app({ id: 'app_2', ownerId: 'someoneelse@corp', policy: policy({ appId: 'app_2', ownerId: 'someoneelse@corp' }) });
  const appsById = new Map<string, ReviewAppLike>([
    ['app_1', reviewable],
    ['app_2', notMine],
  ]);
  const runs: AppRunView[] = [
    run({ id: 'r_old', appId: 'app_1', startedAt: '2026-07-01T00:00:00.000Z' }),
    run({ id: 'r_new', appId: 'app_1', startedAt: '2026-07-05T00:00:00.000Z' }),
    run({ id: 'r_notmine', appId: 'app_2' }), // caller isn't a reviewer for app_2
    run({ id: 'r_done', appId: 'app_1', status: 'done', steps: [step({ status: 'done' })] }), // not awaiting
    run({ id: 'r_noapp', appId: 'app_missing' }), // app not resolved
    run({ id: 'r_noawaiting', appId: 'app_1', steps: [step({ status: 'running' })] }), // no awaiting step
  ];
  const items = scopeInbox(runs, appsById, caller());
  assert.deepEqual(items.map((i) => i.runId), ['r_new', 'r_old']);
});

// ─── faithfulness + guardrail notes ──────────────────────────────────────────────────────────────
const trace = (checks: ReviewAgentTrace['checks'], citations: ReviewAgentTrace['citations'] = []): ReviewAgentTrace => ({
  id: 'ar_1',
  citations,
  checks,
});

test('faithfulnessPct: grounding score → %, null when absent/non-numeric', () => {
  assert.equal(faithfulnessPct(trace([{ name: 'grounding', verdict: 'pass', score: 0.92 }])), 92);
  assert.equal(faithfulnessPct(trace([{ name: 'grounding', verdict: 'pass' }])), null);
  assert.equal(faithfulnessPct(trace([{ name: 'pii', verdict: 'pass' }])), null);
  assert.equal(faithfulnessPct(null), null);
});

test('guardrailNotesFrom: plain sentences for pii/guardrail/injection + generic fallback', () => {
  const notes = guardrailNotesFrom(
    trace([
      { name: 'grounding', verdict: 'pass', score: 0.9 }, // skipped (surfaced as faithfulness)
      { name: 'pii', verdict: 'redacted', detail: 'PAN' },
      { name: 'pii', verdict: 'pass' },
      { name: 'guardrail-rules', verdict: 'pass' },
      { name: 'injection', verdict: 'blocked', detail: 'prompt injection' },
      { name: 'toxicity', verdict: 'warn', detail: 'mild' },
    ]),
  );
  assert.equal(notes.length, 5);
  assert.match(notes[0], /masked before the model saw it \(PAN\)/);
  assert.match(notes[1], /No sensitive personal data/);
  assert.match(notes[2], /All content guardrails passed/);
  assert.match(notes[3], /flagged this: prompt injection/);
  assert.match(notes[4], /toxicity: warn — mild/);
  assert.deepEqual(guardrailNotesFrom(null), []);
});

// ─── recommendationFrom ──────────────────────────────────────────────────────────────────────────
test('recommendationFrom: pending outcome, else last prior, else run outcome, else fallback', () => {
  assert.equal(
    recommendationFrom(run({ steps: [step({ status: 'awaiting_human', outcome: 'Recommend approve' })] })),
    'Recommend approve',
  );
  // pending has no outcome → last prior step's outcome.
  assert.equal(
    recommendationFrom(
      run({
        steps: [
          step({ id: 'a', kind: 'agent', status: 'done', outcome: 'Drafted decision' }),
          step({ id: 'h', kind: 'human', status: 'awaiting_human', outcome: '' }),
        ],
      }),
    ),
    'Drafted decision',
  );
  // nothing → run outcome.
  assert.equal(
    recommendationFrom(run({ outcome: 'Final', steps: [step({ outcome: '' })] })),
    'Final',
  );
  // truly empty.
  assert.match(recommendationFrom(run({ outcome: '', steps: [step({ outcome: '' })] })), /no draft output/);
});

// ─── policyContextFrom ───────────────────────────────────────────────────────────────────────────
// Renamed from "...in plain USD, or generic" — the product moved to INR (money.ts), so this now checks
// the threshold is explained in plain, Indian-grouped rupees, not dollars.
test('policyContextFrom: threshold explained in plain INR, or generic', () => {
  const a = app({ policy: policy({ approval: { thresholdAttribute: 'amount', maxThreshold: 100000 } }) });
  assert.match(policyContextFrom(a, { amount: 500000 }), /₹5,00,000 is above the ₹1,00,000 auto-approval limit/);
  // amount not present → the "amounts above X" form.
  assert.match(policyContextFrom(a, {}), /Amounts above ₹1,00,000 need a manager/);
  // no approval config → generic.
  assert.match(policyContextFrom(app(), {}), /require a person to sign off/);
});

// ─── inputPairs + humanizeKey ────────────────────────────────────────────────────────────────────
// Renamed from "...amount as USD..." — amount fields are formatted as INR now (money.ts), Indian grouping
// and the ₹ symbol, not the old western "$500,000".
test('inputPairs: labelled rows, amount as INR, objects stringified, skips null', () => {
  const pairs = inputPairs({ amount: 500000, employeeId: 'EMP1', meta: { a: 1 }, empty: null });
  assert.deepEqual(pairs, [
    { key: 'Amount', value: '₹5,00,000' },
    { key: 'Employee Id', value: 'EMP1' },
    { key: 'Meta', value: '{"a":1}' },
  ]);
});

test('humanizeKey: snake/camel → Title Case', () => {
  assert.equal(humanizeKey('employee_id'), 'Employee Id');
  assert.equal(humanizeKey('requestedBy'), 'Requested By');
  assert.equal(humanizeKey('amount'), 'Amount');
});

// ─── childRunIdForReview ─────────────────────────────────────────────────────────────────────────
test('childRunIdForReview: pending child first, then last prior child, else null', () => {
  assert.equal(
    childRunIdForReview([step({ status: 'awaiting_human', childRunId: 'ar_pending' })]),
    'ar_pending',
  );
  assert.equal(
    childRunIdForReview([
      step({ id: 'a', kind: 'agent', status: 'done', childRunId: 'ar_upstream' }),
      step({ id: 'h', kind: 'human', status: 'awaiting_human' }),
    ]),
    'ar_upstream',
  );
  assert.equal(childRunIdForReview([step({ status: 'awaiting_human' })]), null);
});

// ─── buildReviewDetail — the whole assembly ──────────────────────────────────────────────────────
test('buildReviewDetail: full plain-language detail with citations, faithfulness, authority', () => {
  const a = app({
    policy: policy({ approval: { approverRoles: ['manager'], thresholdAttribute: 'amount', maxThreshold: 100000 } }),
  });
  const r = run({
    input: { amount: 500000, employeeId: 'EMP00001' },
    steps: [
      step({ id: 'agent', kind: 'agent', status: 'done', outcome: 'Recommend approval', childRunId: 'ar_1' }),
      step({ id: 'human', kind: 'human', status: 'awaiting_human', label: 'Manager sign-off' }),
    ],
  });
  const t = trace(
    [{ name: 'grounding', verdict: 'pass', score: 0.88 }, { name: 'pii', verdict: 'redacted', detail: 'PAN' }],
    [{ ref: 'doc:1', title: 'Reimbursement Policy', snippet: '…limit $100k…', score: 0.7, supported: true }],
  );
  const detail = buildReviewDetail(r, a, t, caller());
  // ₹5,00,000 — INR, Indian grouping (money.ts), not the old western $500,000.
  assert.equal(detail.question, 'Approve ₹5,00,000 — Reimbursement Approver for EMP00001?');
  assert.equal(detail.amountLabel, '₹5,00,000');
  assert.equal(detail.requestedBy, 'EMP00001');
  assert.equal(detail.stepLabel, 'Manager sign-off');
  assert.equal(detail.recommendation, 'Recommend approval');
  assert.equal(detail.faithfulnessPct, 88);
  assert.equal(detail.citations.length, 1);
  assert.equal(detail.citations[0].scorePct, 70);
  assert.equal(detail.citations[0].supported, true);
  assert.match(detail.policyContext, /above the ₹1,00,000/);
  // $500,000 > manager's $100,000 authority → cannot approve, reason surfaced.
  assert.equal(detail.canApprove, false);
  assert.match(detail.approveBlockedReason ?? '', /exceeds approver authority/);
  // and a manager under the limit CAN approve.
  const under = buildReviewDetail(run({ input: { amount: 50000 }, steps: r.steps }), a, t, caller());
  assert.equal(under.canApprove, true);
  assert.equal(under.approveBlockedReason, null);
});

test('buildReviewDetail: degrades cleanly with no trace', () => {
  const detail = buildReviewDetail(run({ input: {} }), app(), null, caller({ role: 'admin' }));
  assert.equal(detail.faithfulnessPct, null);
  assert.deepEqual(detail.citations, []);
  assert.deepEqual(detail.guardrailNotes, []);
  assert.equal(detail.canApprove, true); // admin, no approval constraint
});
