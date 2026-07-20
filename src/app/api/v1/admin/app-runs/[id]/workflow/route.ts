import { NextResponse } from 'next/server';
import { cancelWorkflow, resetWorkflow } from '@/lib/adapters/agentruntime';
import { submitAppRun } from '@/lib/adapters/apprun';
import { appWorkflowIdFor } from '@/lib/app-run-durable';
import { decideAppRunControl, parseAppRunControlAction } from '@/lib/app-run-control';
import { newAppRunId } from '@/lib/app-run';
import { getAppRun, markAppRunCancelled } from '@/lib/app-run-store';
import { getAppRunView } from '@/lib/app-runs-view-reader';
import { getApp } from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { askerFrom } from '@/lib/retrieval/acl';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── run-actions: comprehensive durable APP-RUN workflow control ─────────────────────────────────
// POST /api/v1/admin/app-runs/[id]/workflow { action: 'cancel'|'terminate'|'reset'|'rerun' }
//
// The full operator intervention matrix for the REAL durable runs (multi-step / HITL app-run
// workflows). Eligibility is the pure decideAppRunControl (in-flight → cancel/terminate; terminal →
// reset/rerun); a bad action is 400, an ineligible one 409, a missing workflow 404, unreachable 502.
//   • cancel/terminate → stop the workflow (adapter cancelWorkflow) + reconcile the row to cancelled.
//   • reset            → REPLAY the finished workflow from its start (adapter resetWorkflow); the
//                        re-execution re-persists into the same run row.
//   • rerun            → dispatch a FRESH run from the original input (submitAppRun, new run id).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  const action = parseAppRunControlAction(body?.action);
  if (!action) {
    return NextResponse.json(
      { error: 'action must be one of cancel|terminate|reset|rerun' },
      { status: 400 },
    );
  }

  const run = await getAppRunView(id, orgId);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });

  const decision = decideAppRunControl(run.status, action);
  if (!decision.allow) return NextResponse.json({ error: decision.reason }, { status: 409 });

  const workflowId = appWorkflowIdFor(run.appId, run.id);

  // ── rerun: dispatch a fresh run from the original input ──────────────────────────────────────
  if (action === 'rerun') {
    const app = await getApp(run.appId, orgId);
    if (!app) return NextResponse.json({ error: 'app not found' }, { status: 404 });
    const prior = await getAppRun(run.id, orgId);
    const input = (prior?.input ?? {}) as Record<string, unknown>;
    const newRunId = newAppRunId();
    try {
      await submitAppRun(app, input, {
        orgId,
        actor: gate.user.email ?? undefined,
        runId: newRunId,
        asker: askerFrom(gate.user),
      });
    } catch (e) {
      return NextResponse.json({ error: `rerun dispatch failed: ${(e as Error).message}` }, { status: 502 });
    }
    auditFromSession(gate, orgId, {
      action: 'apprun.workflow.rerun',
      resource: `apprun:${run.id} -> apprun:${newRunId}`,
      outcome: 'ok',
    });
    return NextResponse.json({ ok: true, action, id: run.id, newRunId, by: gate.user.email }, { status: 201 });
  }

  // ── reset: replay the finished workflow from its start ───────────────────────────────────────
  if (action === 'reset') {
    const res = await resetWorkflow(workflowId);
    if (!res.ok) {
      const status = res.reason === 'not_found' ? 404 : res.reason === 'not_configured' ? 409 : 502;
      return NextResponse.json({ error: res.error }, { status });
    }
    auditFromSession(gate, orgId, {
      action: 'apprun.workflow.reset',
      resource: `apprun:${run.id} workflow:${workflowId}`,
      outcome: 'ok',
    });
    return NextResponse.json({ ok: true, action, id: run.id, workflowId, by: gate.user.email });
  }

  // ── cancel / terminate: stop the in-flight workflow + reconcile the row ──────────────────────
  const res = await cancelWorkflow(workflowId, action);
  if (!res.ok) {
    const status = res.reason === 'not_found' ? 404 : res.reason === 'not_configured' ? 409 : 502;
    return NextResponse.json({ error: res.error }, { status });
  }
  await markAppRunCancelled(run.id, orgId);
  auditFromSession(gate, orgId, {
    action: action === 'terminate' ? 'apprun.workflow.terminate' : 'apprun.workflow.cancel',
    resource: `apprun:${run.id} workflow:${workflowId}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, action, id: run.id, workflowId, by: gate.user.email });
}
