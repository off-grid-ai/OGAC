import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caseLabel, runSubject } from '../src/lib/app-work-queue.ts';
import { recommendationFrom } from '../src/lib/review-inbox.ts';
import type { AppRunView } from '../src/lib/app-runs-view.ts';

// ─── What the per-app Review tab's cards must say ─────────────────────────────────────────────────
//
// The card used to lead with the raw run id and use the PENDING step's outcome as its body. Both were
// wrong for a human step: a human step has no outcome until someone decides, so every card showed a
// mono uuid over a bare step label and nothing a reviewer could act on. These assertions are over the
// exact two pure rules the card composes, on run shapes copied from the live demo tenants.

/** A run shaped like the ones the live Reimbursement Approval app produces (case inside the envelope). */
const envelopeRun: AppRunView = {
  id: 'apprun_54419080',
  appId: 'bhapp_reimb',
  status: 'awaiting_human',
  input: {
    body: {
      case: {
        id: 1,
        claim_no: 'EXP-2025-00001',
        employee_name: 'Meera Malhotra',
        category: 'Training',
        amount: '41346.44',
        status: 'submitted',
      },
      input: { input: 'Meera Malhotra · submitted · 41,346.44' },
    },
  },
  steps: [
    {
      id: 's2',
      kind: 'agent',
      label: 'Decide eligibility',
      status: 'done',
      outcome:
        'Claim amount: ₹41346.44\nRemaining quota: ₹137454.12\nHeadroom: ₹96107.68\n\nRecommendation: within quota — approve',
    },
    { id: 's3', kind: 'human', label: 'Approve or reject', status: 'awaiting_human' },
    { id: 's4', kind: 'output', label: 'Reimbursement decision', status: 'queued' },
  ],
  outcome: '',
  provenance: null,
  startedAt: '2026-08-04T09:52:47.462Z',
  finishedAt: null,
};

/** A run shaped like the insurer apps' (an author-written `subject` at the top level). */
const subjectRun: AppRunView = {
  id: 'apprun_dd62af05',
  appId: 'app_14940314',
  status: 'awaiting_human',
  input: { subject: 'Death claim CLM0000008 — Pari Kapoor', policy_no: 'SL6156891483' },
  steps: [
    {
      id: 's2',
      kind: 'agent',
      label: 'Assess claim risk',
      status: 'done',
      outcome: 'Early-claim indicator present; refer to SIU before settlement.',
    },
    { id: 's3', kind: 'human', label: 'Claims committee review', status: 'awaiting_human' },
  ],
  outcome: '',
  provenance: null,
  startedAt: '2026-08-05T12:10:00.000Z',
  finishedAt: null,
};

test('the card is titled by the case, never by the run id', () => {
  const title = caseLabel(runSubject(envelopeRun.input), envelopeRun.id);
  assert.match(title, /Meera Malhotra/);
  // The specific regression: the run id must not be what a reviewer reads.
  assert.ok(!title.includes('apprun_54419080'), `title still leaks the run id: ${title}`);

  const insurerTitle = caseLabel(runSubject(subjectRun.input), subjectRun.id);
  assert.equal(insurerTitle, 'Death claim CLM0000008 — Pari Kapoor');
});

test('an unsummarisable input still gets a distinguishable label, not a bare word', () => {
  // Honest fallback: we never invent a subject, but two such cards must still be tellable apart.
  const a = caseLabel(runSubject({}), 'apprun_54419080');
  const b = caseLabel(runSubject({}), 'apprun_dd62af05');
  assert.notEqual(a, b);
  assert.match(a, /^Case /);
});

test('the card body is the app recommendation being approved, not the empty human step', () => {
  const pending = envelopeRun.steps.find((s) => s.status === 'awaiting_human');
  // Proof the OLD source of the card body carries nothing at this point in the run.
  assert.equal(pending?.outcome ?? '', '');
  // …and that the rule the card now uses does carry the decision.
  const rec = recommendationFrom(envelopeRun);
  assert.match(rec, /Recommendation: within quota — approve/);
  assert.match(recommendationFrom(subjectRun), /refer to SIU/);
});

test('a run with no agent output says so rather than showing a blank card', () => {
  const bare: AppRunView = {
    ...subjectRun,
    steps: [{ id: 's3', kind: 'human', label: 'Claims committee review', status: 'awaiting_human' }],
    outcome: '',
  };
  const rec = recommendationFrom(bare);
  assert.ok(rec.trim().length > 0, 'the card must never render an empty body');
  assert.match(rec, /no draft output/i);
});
