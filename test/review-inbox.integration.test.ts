import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the HITL REVIEW INBOX — exercises the REAL server-only reader
// (review-inbox-reader.ts) wired to the REAL stores (apps-store, app-run-store, app-access, agentrun)
// and the REAL pure logic (review-inbox.ts) against a live Postgres. It proves the exact reviewer
// experience the brief requires:
//   • the pending-review inbox is SCOPED to what the caller may review (approver role vs a stranger)
//   • each inbox item carries the plain-language decision + amount + canApprove authority
//   • the review DETAIL pulls the child agent-run's citations + faithfulness + guardrail notes
//   • approve-with-authority vs under-authority-rejected is reflected in canApprove/blocked-reason
//
// Skips green if the DB is down. Writes under a dedicated org; cleans up.

const ORG = 'test-int-review-inbox';
const OWNER = 'owner@corp';

const dbUp = await dbReachable();

test('HITL review inbox against a real Postgres', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { createApp, deleteApp } = await import('@/lib/apps-store');
  const { setAppAccessPolicy, deleteAppAccessPolicy, ensureAppAccessSchema } = await import('@/lib/app-access');
  const { upsertAppRunState } = await import('@/lib/app-run-store');
  const { getReviewInbox, getReviewDetail } = await import('@/lib/review-inbox-reader');
  const { db } = await import('@/db');
  const { agentRuns } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  await ensureAppAccessSchema();

  // ── seed: an app + an approval-authority policy (manager may approve up to $100,000) ──
  const app = await createApp(ORG, OWNER, {
    title: 'Reimbursement Approver',
    summary: 'Approves employee reimbursements above the auto-limit',
    steps: [
      { id: 'draft', kind: 'agent', label: 'Draft decision', inlineAgent: { systemPrompt: 'decide', model: '' } },
      { id: 'signoff', kind: 'human', label: 'Manager sign-off' },
    ],
    edges: [{ from: 'draft', to: 'signoff' }],
  } as never);

  await setAppAccessPolicy(app.id, ORG, OWNER, {
    actions: { approve: { roles: ['manager'] } },
    approval: { approverRoles: ['manager'], thresholdAttribute: 'amount', maxThreshold: 100000 },
  });

  // ── seed: a child agent-run with citations + a grounding (faithfulness) + a pii check ──
  const childId = `ar_int_${Date.now()}`;
  await db.insert(agentRuns).values({
    id: childId,
    orgId: ORG,
    agentId: 'agent_x',
    query: 'reimbursement decision',
    answer: 'Recommend approval — within policy.',
    status: 'done',
    steps: [],
    citations: [{ ref: 'doc:1', title: 'Reimbursement Policy', snippet: 'limit is $100,000', score: 0.72, supported: true }],
    checks: [
      { name: 'grounding', verdict: 'pass', score: 0.88 },
      { name: 'pii', verdict: 'redacted', detail: 'PAN' },
    ],
    provenance: null,
  } as never);

  // ── seed: an awaiting_human run for that app (amount $500,000 → above manager authority) ──
  const runId = `apprun_int_${Date.now()}`;
  await upsertAppRunState(
    {
      runId,
      appId: app.id,
      status: 'awaiting_human',
      steps: [
        { id: 'draft', kind: 'agent', label: 'Draft decision', status: 'done', outcome: 'Recommend approval — within policy.', childRunId: childId },
        { id: 'signoff', kind: 'human', label: 'Manager sign-off', status: 'awaiting_human' },
      ],
    } as never,
    { amount: 500000, employeeId: 'EMP00001' },
    ORG,
  );

  t.after(async () => {
    await db.delete(agentRuns).where(eq(agentRuns.id, childId)).catch(() => {});
    await deleteAppAccessPolicy(app.id, ORG).catch(() => {});
    await deleteApp(app.id, ORG).catch(() => {});
    // The app_runs row: best-effort direct cleanup.
    try {
      const { appRuns } = await import('@/db/schema');
      await db.delete(appRuns).where(eq(appRuns.id, runId));
    } catch {
      /* ignore */
    }
  });

  const manager = { role: 'manager', department: null, orgId: ORG, userId: 'mgr@corp' };
  const stranger = { role: 'analyst', department: null, orgId: ORG, userId: 'nope@corp' };

  // ── the inbox is SCOPED: the manager sees it, the stranger does not ──
  const mgrInbox = await getReviewInbox(manager, ORG, 200);
  const mine = mgrInbox.find((i) => i.runId === runId);
  assert.ok(mine, 'manager sees the pending run in their inbox');
  assert.equal(mine.amountLabel, '$500,000');
  assert.equal(mine.appTitle, 'Reimbursement Approver');
  // $500,000 is above the manager's $100,000 authority → surfaced as cannot-approve (but still shown).
  assert.equal(mine.canApprove, false);

  const strangerInbox = await getReviewInbox(stranger, ORG, 200);
  assert.equal(strangerInbox.find((i) => i.runId === runId), undefined, 'a non-reviewer sees nothing');

  // ── the DETAIL pulls the child trace: citations + faithfulness + guardrail notes ──
  const detail = await getReviewDetail(runId, manager, ORG);
  assert.ok(detail);
  assert.equal(detail.question, 'Approve $500,000 — Reimbursement Approver for EMP00001?');
  assert.equal(detail.faithfulnessPct, 88);
  assert.equal(detail.citations.length, 1);
  assert.equal(detail.citations[0].title, 'Reimbursement Policy');
  assert.equal(detail.citations[0].scorePct, 72);
  assert.ok(detail.guardrailNotes.some((n) => /masked before the model/.test(n)));
  assert.match(detail.policyContext, /above the \$100,000/);
  // under-authority: manager cannot approve $500,000, reason surfaced (gracefully, not a crash).
  assert.equal(detail.canApprove, false);
  assert.match(detail.approveBlockedReason ?? '', /exceeds approver authority/);

  // ── approve-WITH-authority: the same manager on a $50,000 run CAN approve ──
  const smallRunId = `apprun_int_small_${Date.now()}`;
  await upsertAppRunState(
    {
      runId: smallRunId,
      appId: app.id,
      status: 'awaiting_human',
      steps: [{ id: 'signoff', kind: 'human', label: 'Manager sign-off', status: 'awaiting_human' }],
    } as never,
    { amount: 50000, employeeId: 'EMP00002' },
    ORG,
  );
  t.after(async () => {
    const { appRuns } = await import('@/db/schema');
    await db.delete(appRuns).where(eq(appRuns.id, smallRunId)).catch(() => {});
  });
  const smallDetail = await getReviewDetail(smallRunId, manager, ORG);
  assert.ok(smallDetail);
  assert.equal(smallDetail.canApprove, true, 'manager can approve within their $100,000 authority');
  assert.equal(smallDetail.approveBlockedReason, null);
});
