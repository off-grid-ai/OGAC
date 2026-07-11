import { NextResponse } from 'next/server';
import { signalAppRun } from '@/lib/adapters/apprun';
import { callerFromSession } from '@/lib/app-access-caller';
import { defaultDeps } from '@/lib/app-run';
import { rebuildAppRunState } from '@/lib/app-run-plan';
import { resumeAppRun } from '@/lib/app-run-resume';
import { canReview, awaitingStep } from '@/lib/app-runs-view';
import { getAppRunView } from '@/lib/app-runs-view-reader';
import { enforceAppAccessWithSharing } from '@/lib/app-sharing';
import { getApp } from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import { captureHitlCorrection } from '@/lib/feedback-store';

export const dynamic = 'force-dynamic';

// ─── App-run REVIEW route (Builder Epic Phase 4A, HITL — screen 4) ────────────────────────────────
// POST /api/v1/admin/apps/runs/[id]/review { decision:'approve'|'reject', output?, note?, stepId? }
//
// Resumes a run PAUSED mid-workflow at a `human` step. We derive the awaiting step from the persisted
// app_runs row (so the caller need not know the step id), verify the run is actually reviewable (pure
// canReview), then resume it — by WHICHEVER path the run is actually on:
//
//   • DURABLE — a live AppRunWorkflow is waiting on a `resumeStep` signal (adapters/apprun.signalAppRun);
//     approve → the workflow continues, reject → it halts. Tried FIRST.
//   • INLINE — the run executed in-process (no durable workflow) and terminated at the human pause, so
//     there is no workflow to signal (signalAppRun reports not_configured or not_found). We then resume
//     the run IN-PROCESS: apply the decision to the awaiting step and continue the remaining downstream
//     steps to completion (or the next human pause), persisting per-step state exactly as runApp does.
//     Approve JUST WORKS; reject halts the run cleanly. No infra/engine internals ever reach the user.
//
// Only if a live workflow is genuinely unreachable mid-signal (reason:'unreachable') do we return a
// 502 with a PLAIN message — the run stays paused and can be reviewed again in a moment.
//
// SOLID: thin handler — auth, org, load+guard (pure), resume (durable adapter OR pure inline resume),
// audit. All scheduling/decision logic is pure (app-run-plan / app-run-resume); no loop lives here.
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

  // resumedInline tracks which path completed the review, for the response + audit.
  let resumedInline = false;

  if (!signal.ok) {
    // "Nothing to resume" (durable off, or no live workflow) ⇒ the run executed INLINE and is paused
    // in the persisted row. Resume it IN-PROCESS: apply the decision, run the remaining downstream
    // steps to completion (or the next human pause), persisting per-step state as runApp does. This
    // is what makes Approve JUST WORK for a non-technical reviewer without the durable runtime.
    if (signal.reason === 'not_configured' || signal.reason === 'not_found') {
      const app = await getApp(run.appId, orgId);
      if (!app) {
        auditFromSession(gate, orgId, {
          action: 'app.run.review',
          resource: `app_run:${id}`,
          outcome: 'error',
        });
        // Plain, user-facing — never leaks that the app definition couldn't be loaded internally.
        return NextResponse.json(
          { error: "This run couldn't be resumed right now. Please try again in a moment." },
          { status: 502 },
        );
      }
      const paused = rebuildAppRunState(run.id, run.appId, run.status, run.steps);
      await resumeAppRun(
        app,
        paused,
        run.input ?? {},
        { decision: body.decision, output: body.output, note: body.note },
        { orgId, actor: gate.user.email ?? undefined, runId: run.id },
        defaultDeps(),
      );
      resumedInline = true;
    } else {
      // Only a genuine mid-signal outage (Temporal reachable-but-erroring) lands here. PLAIN message —
      // zero env-var/engine/queue internals. The run stays paused; the reviewer can retry shortly.
      auditFromSession(gate, orgId, {
        action: 'app.run.review',
        resource: `app_run:${id}`,
        outcome: 'error',
      });
      return NextResponse.json(
        { error: "This run couldn't be resumed right now. Please try again in a moment." },
        { status: 502 },
      );
    }
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
    resumedInline,
    workflowId: signal.workflowId,
    by: gate.user.email,
    feedbackCaptured,
  });
}
