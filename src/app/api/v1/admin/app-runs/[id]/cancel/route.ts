import { NextResponse } from 'next/server';
import { cancelWorkflow } from '@/lib/adapters/agentruntime';
import { appWorkflowIdFor } from '@/lib/app-run-durable';
import { decideAppRunControl, parseAppRunControlAction } from '@/lib/app-run-control';
import { getAppRunView } from '@/lib/app-runs-view-reader';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// POST → cancel (graceful) or terminate (force) a running/paused durable APP-RUN workflow, by app-run
// id. Body/query { mode: 'cancel' | 'terminate' } (default 'cancel'). This is run-actions for the
// real durable runs (multi-step / HITL apps), distinct from the agent-run workflow controls. The
// eligibility decision is pure (decideAppRunControl); a terminal run is a clean 409, a missing
// workflow 404, unreachable 502 — never an unhandled 5xx.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const run = await getAppRunView(id, orgId);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });

  const url = new URL(req.url);
  const body = (await req.json().catch(() => null)) as { mode?: unknown } | null;
  const action = parseAppRunControlAction(body?.mode ?? url.searchParams.get('mode'));

  const decision = decideAppRunControl(run.status, action);
  if (!decision.allow) return NextResponse.json({ error: decision.reason }, { status: 409 });

  const workflowId = appWorkflowIdFor(run.appId, run.id);
  const res = await cancelWorkflow(workflowId, action);
  if (res.ok) {
    auditFromSession(gate, orgId, {
      action: action === 'terminate' ? 'apprun.workflow.terminate' : 'apprun.workflow.cancel',
      resource: `apprun:${run.id} workflow:${workflowId}`,
      outcome: 'ok',
    });
    return NextResponse.json({ ok: true, id: run.id, workflowId, mode: action, by: gate.user.email });
  }
  const status = res.reason === 'not_found' ? 404 : res.reason === 'not_configured' ? 409 : 502;
  return NextResponse.json({ error: res.error }, { status });
}
