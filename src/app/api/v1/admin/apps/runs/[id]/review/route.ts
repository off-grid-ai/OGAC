import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { canReview, awaitingStep } from '@/lib/app-runs-view';
import { getAppRunView } from '@/lib/app-runs-view-reader';
import { signalAppRun } from '@/lib/adapters/apprun';
import { getApp } from '@/lib/apps-store';
import { captureHitlCorrection } from '@/lib/feedback-store';
import { enforceAppAccessWithSharing } from '@/lib/app-sharing';
import { callerFromSession } from '@/lib/app-access-caller';

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

  // HITL APPROVAL AUTHORITY — an approver must hold the authority the consumer's access policy
  // requires (approver role/user + threshold). The run's ORIGINAL INPUT is the ABAC surface (a
  // threshold attribute like `amount` lives there), so an under-authority approver is rejected even
  // on an approve. Only the `approve` decision is gated here; a `reject` needs no authority (anyone
  // reviewing may halt a run). Denied → 403 + reason, audited access.denied.
  if (body.decision === 'approve') {
    const app = await getApp(run.appId, orgId);
    const runInput = run.input ?? {};
    const caller = await callerFromSession(gate, orgId);
    const access = await enforceAppAccessWithSharing({
      appId: run.appId,
      orgId,
      ownerId: app?.ownerId ?? '',
      caller,
      action: 'approve',
      requestAttrs: runInput,
    });
    if (!access.allow) {
      auditFromSession(gate, orgId, {
        action: 'access.denied',
        resource: `app_run:${id} approve`,
        outcome: 'blocked',
      });
      return NextResponse.json({ error: 'access denied', reason: access.reason }, { status: 403 });
    }
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

  // M1 LEARN: capture the reviewer's correction as a golden case for the run's bound pipeline, so the
  // next eval run is measured against real HITL feedback. Only fires when the reviewer supplied a
  // ground-truth (an edited output or a note); the pure mapper reasons out an approve-with-no-edit.
  // Best-effort — never fails the review. The query is the run input; expected is the correction.
  let feedbackCaptured = false;
  try {
    const app = await getApp(run.appId, orgId);
    const pipelineId = app?.pipelineId ?? null;
    const query =
      typeof run.input === 'string' ? run.input : JSON.stringify(run.input ?? '');
    const res = await captureHitlCorrection(
      { input: query, correctedOutput: body.output, note: body.note, decision: body.decision },
      pipelineId,
    );
    feedbackCaptured = res.captured;
  } catch {
    feedbackCaptured = false;
  }

  return NextResponse.json({
    ok: true,
    decision: body.decision,
    stepId,
    workflowId: signal.workflowId,
    by: gate.user.email,
    feedbackCaptured,
  });
}
