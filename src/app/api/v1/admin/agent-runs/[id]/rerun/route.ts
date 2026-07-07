import { after, NextResponse } from 'next/server';
import { getAgentRun, scoreRun } from '@/lib/agentrun';
import { dispatchAgentRun } from '@/lib/agent-run-dispatch';
import { canRerun } from '@/lib/agent-run-actions';
import { actorFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// POST → re-dispatch the same agent+input as a prior run, producing a fresh traced run through the
// full interaction pipeline (C). Goes through dispatchAgentRun so a rerun inherits DURABILITY: when
// OFFGRID_QUEUE_ENABLED=1 / OFFGRID_ADAPTER_AGENTRUNTIME=temporal and the cluster is reachable it
// executes on the Temporal worker (durable/resumable/cancelable); otherwise it degrades gracefully
// to the synchronous in-process path. The QA score runs after the response is flushed.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const prior = await getAgentRun(id);
  if (!prior) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  if (!canRerun(prior.status)) {
    return NextResponse.json({ error: `run status ${prior.status} is not re-runnable` }, { status: 409 });
  }
  const d = await dispatchAgentRun({
    agentId: prior.agentId,
    query: prior.query,
    caller: gate.user.email ?? undefined,
    orgId: await currentOrgId(),
    actor: actorFromSession(gate),
  });
  // Durable submit accepted but still executing in the worker — 202 with the ids so the client polls.
  if (d.mode === 'pending') {
    return NextResponse.json(
      { status: 'running', runId: d.runId, workflowId: d.workflowId, run: d.run, mode: d.mode },
      { status: 202 },
    );
  }
  if (!d.run) return NextResponse.json({ error: 'unknown agent' }, { status: 404 });
  after(() => scoreRun(d.run!));
  return NextResponse.json(d.run, { status: 201 });
}
