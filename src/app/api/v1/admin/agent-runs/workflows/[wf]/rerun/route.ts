import { after, NextResponse } from 'next/server';
import { getAgentRun, scoreRun } from '@/lib/agentrun';
import { dispatchAgentRun } from '@/lib/agent-run-dispatch';
import { actorFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import { runIdFromWorkflowId } from '@/lib/temporal-visibility';

export const dynamic = 'force-dynamic';

// POST → re-run a durable workflow: re-dispatch the SAME agent+query as a fresh run. We correlate
// the Temporal workflowId back to the recorded run (the workflowId embeds the console runId) and
// re-submit through dispatchAgentRun — which re-enters the DURABLE Temporal path when it's enabled
// and reachable, or degrades to the synchronous in-process path otherwise. This makes "rerun a job"
// work from the Jobs surface regardless of runtime.
//
// A rerun does not require Temporal to be reachable (the source run lives in the DB); dispatch's
// graceful fallback covers the unreachable case. The QA score runs after the response flushes.
export async function POST(req: Request, { params }: { params: Promise<{ wf: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { wf } = await params;
  const workflowId = decodeURIComponent(wf);

  const runId = runIdFromWorkflowId(workflowId);
  if (!runId) {
    return NextResponse.json(
      { error: 'workflow is not an agent-run workflow (no correlated runId to rerun)' },
      { status: 400 },
    );
  }
  // Scope the correlated-run lookup to the caller's org — a workflow id from another tenant resolves
  // to 404 (a rerun may only re-dispatch a run that belongs to the caller's tenant; IDOR blocked).
  const orgId = await currentOrgId();
  const prior = await getAgentRun(runId, orgId);
  if (!prior) {
    return NextResponse.json(
      { error: `no recorded run ${runId} correlated to this workflow` },
      { status: 404 },
    );
  }
  const d = await dispatchAgentRun({
    agentId: prior.agentId,
    query: prior.query,
    caller: gate.user.email ?? undefined,
    orgId,
    actor: actorFromSession(gate),
  });
  // Durable submit accepted but still executing in the worker — 202 with the ids so the client polls.
  if (d.mode === 'pending') {
    return NextResponse.json(
      { ok: true, status: 'running', runId: d.runId, workflowId: d.workflowId, run: d.run, mode: d.mode, sourceWorkflowId: workflowId },
      { status: 202 },
    );
  }
  if (!d.run) return NextResponse.json({ error: 'unknown agent' }, { status: 404 });
  after(() => scoreRun(d.run!));
  return NextResponse.json({ ok: true, run: d.run, sourceWorkflowId: workflowId }, { status: 201 });
}
