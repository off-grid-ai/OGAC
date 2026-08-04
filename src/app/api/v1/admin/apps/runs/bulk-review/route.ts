import { NextResponse } from 'next/server';
import { listAppRuns } from '@/lib/app-run-store';
import { runSubject } from '@/lib/app-work-queue';
import { auditFromSession } from '@/lib/audit-actor';
import { requireWriter } from '@/lib/authz';
import {
  summariseBulk,
  validateBulk,
  type BulkCandidate,
  type BulkDecision,
  type BulkOutcome,
} from '@/lib/bulk-decide';
import { daysWaiting } from '@/lib/my-work';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Decide many cases at once ───────────────────────────────────────────────────────────────────────
//
// Seven near-identical reimbursements were seven round trips. This is the batch form of the same
// decision — and deliberately NOT a second decision path: each case is posted through the very review
// route a single decision uses, so the durable workflow resumes identically, the correction loop still
// captures the note, and there is no second copy of the governance to keep in step.
//
// The pure rules (one app per batch, a cap, a reason for rejection) live in bulk-decide.ts.

export async function POST(req: Request) {
  // A writer, not merely a signed-in user: this is a governed decision, in bulk.
  const gate = await requireWriter(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => null)) as {
    appId?: string;
    runIds?: string[];
    decision?: BulkDecision;
    note?: string;
  } | null;

  const appId = String(body?.appId ?? '').trim();
  const runIds = Array.isArray(body?.runIds) ? body.runIds.map(String) : [];
  const decision: BulkDecision = body?.decision === 'reject' ? 'reject' : 'approve';
  const note = String(body?.note ?? '').trim();
  if (!appId || runIds.length === 0) {
    return NextResponse.json({ error: 'Pick the cases to decide.' }, { status: 400 });
  }

  const orgId = await currentOrgId();

  // Re-read the runs SERVER-SIDE rather than trusting what the browser selected. Between the page
  // loading and the click, somebody else may have decided one of these — approving it twice, or
  // approving something that moved on, is exactly the damage a batch makes easy.
  const rows = await listAppRuns(appId, orgId, 200).catch(() => []);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const now = new Date();

  const selected: BulkCandidate[] = runIds.map((id) => {
    const r = byId.get(id);
    const steps = ((r as { steps?: { id?: string; status?: string }[] } | undefined)?.steps ?? []);
    return {
      runId: id,
      appId,
      appTitle: appId,
      pendingStepId:
        String(r?.status) === 'awaiting_human'
          ? (steps.find((s) => s.status === 'awaiting_human')?.id ?? null)
          : null,
      label: runSubject((r as { input?: unknown } | undefined)?.input) ?? id,
      daysWaiting: daysWaiting(String(r?.startedAt ?? ''), now),
    };
  });

  const check = validateBulk(selected, decision, note);
  if (!check.ok) {
    return NextResponse.json(
      { error: 'This batch cannot be applied.', reasons: check.errors, skipped: check.skipped },
      { status: 400 },
    );
  }

  // Sequential on purpose. These resume durable workflows; firing them in parallel buys a second and
  // makes a partial failure much harder to reason about afterwards.
  const origin = new URL(req.url).origin;
  const cookie = req.headers.get('cookie') ?? '';
  const outcomes: BulkOutcome[] = [];
  for (const c of check.eligible) {
    try {
      const res = await fetch(
        `${origin}/api/v1/admin/apps/runs/${encodeURIComponent(c.runId)}/review`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({
            decision,
            stepId: c.pendingStepId,
            ...(note ? { note } : {}),
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      outcomes.push({ runId: c.runId, ok: res.ok && data.ok === true, reason: data.error });
    } catch (e) {
      outcomes.push({
        runId: c.runId,
        ok: false,
        reason: e instanceof Error ? e.message : 'the decision could not be sent',
      });
    }
  }

  auditFromSession(gate, orgId, {
    action: `apps.run.bulk-${decision}`,
    resource: `app:${appId}:${outcomes.filter((o) => o.ok).length}/${outcomes.length}`,
    outcome: outcomes.every((o) => o.ok) ? 'ok' : 'error',
  });

  return NextResponse.json({
    summary: summariseBulk(outcomes, decision),
    decided: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).length,
    outcomes,
    skipped: check.skipped,
  });
}
