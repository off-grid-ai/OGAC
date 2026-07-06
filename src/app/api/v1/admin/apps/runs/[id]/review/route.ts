import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { canReview, awaitingStep } from '@/lib/app-runs-view';
import { getAppRunView } from '@/lib/app-runs-view-reader';
import { signalAppRun } from '@/lib/adapters/apprun';

export const dynamic = 'force-dynamic';

// ─── App-run REVIEW route (Builder Epic Phase 4A, HITL — screen 4) ────────────────────────────────
// POST /api/v1/admin/apps/runs/[id]/review { decision:'approve'|'reject', output?, note?, stepId? }
//
// Resumes a run PAUSED mid-workflow at a `human` step. The durable AppRunWorkflow is waiting on a
// `resumeStep` signal (adapters/apprun.signalAppRun); approve → the workflow continues, reject →
// it halts. We derive the awaiting step from the persisted app_runs row (so the caller need not
// know the step id), verify the run is actually reviewable (pure canReview), then signal.
//
// GRACEFUL on the two failure modes the brief calls out:
//   • INLINE run — a run executed in-process (no durable workflow) has ALREADY terminated at the
//     human pause; there is nothing to resume. signalAppRun reports not_configured (durable off) or
//     not_found (no live workflow) → we return 409 with a clear message: this run can't be resumed;
//     re-run the app with the durable runtime enabled to use human-in-the-loop.
//   • Temporal unreachable — 502 with the degraded reason (the fleet is down); the run stays paused
//     and can be reviewed again once Temporal is back.
//
// SOLID: thin handler — auth, org, load+guard (pure), signal (adapter), audit.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const orgId = await currentOrgId();

  const body = (await req.json().catch(() => ({}))) as {
    decision?: 'approve' | 'reject';
    output?: string;
    note?: string;
    stepId?: string;
  };
  if (body.decision !== 'approve' && body.decision !== 'reject') {
    return NextResponse.json({ error: 'decision must be approve|reject' }, { status: 400 });
  }

  const run = await getAppRunView(id, orgId);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });

  if (!canReview(run)) {
    return NextResponse.json(
      { error: `run is ${run.status}, not awaiting a human decision` },
      { status: 409 },
    );
  }

  // The step to resume — the run's awaiting_human step (or an explicit override that matches it).
  const pending = awaitingStep(run.steps)!;
  const stepId = body.stepId && body.stepId === pending.id ? body.stepId : pending.id;

  const signal = await signalAppRun(run.appId, id, {
    stepId,
    decision: body.decision,
    output: body.output,
    note: body.note,
  });

  if (!signal.ok) {
    auditFromSession(gate, orgId, {
      action: 'app.run.review',
      resource: `app_run:${id}`,
      outcome: 'error',
    });
    // Distinguish "nothing to resume" (inline / closed workflow) from "fleet down".
    if (signal.reason === 'not_configured' || signal.reason === 'not_found') {
      return NextResponse.json(
        {
          error:
            'This run cannot be resumed — it ran inline (no durable workflow to signal). ' +
            'Human-in-the-loop resume requires the durable runtime; re-run the app with ' +
            'OFFGRID_QUEUE_ENABLED=1 so the run pauses on a resumable workflow.',
          reason: signal.reason,
          resumable: false,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: signal.error ?? 'Temporal unreachable — the run stays paused; try again once it is back.', reason: signal.reason },
      { status: 502 },
    );
  }

  auditFromSession(gate, orgId, {
    action: 'app.run.review',
    resource: `app_run:${id}`,
    outcome: 'ok',
  });

  return NextResponse.json({
    ok: true,
    decision: body.decision,
    stepId,
    workflowId: signal.workflowId,
    by: gate.user.email,
  });
}
