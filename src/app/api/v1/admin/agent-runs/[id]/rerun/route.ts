import { after, NextResponse } from 'next/server';
import { getAgentRun, runAgent, scoreRun } from '@/lib/agentrun';
import { canRerun } from '@/lib/agent-run-actions';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// POST → re-dispatch the same agent+input as a prior run, producing a fresh traced run through the
// full interaction pipeline (C). Reuses runAgent; the QA score runs after the response is flushed.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const prior = await getAgentRun(id);
  if (!prior) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  if (!canRerun(prior.status)) {
    return NextResponse.json({ error: `run status ${prior.status} is not re-runnable` }, { status: 409 });
  }
  const run = await runAgent(prior.agentId, prior.query, gate.user.email ?? undefined, false, await currentOrgId());
  if (!run) return NextResponse.json({ error: 'unknown agent' }, { status: 404 });
  after(() => scoreRun(run));
  return NextResponse.json(run, { status: 201 });
}
