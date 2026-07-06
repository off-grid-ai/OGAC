import { after, NextResponse } from 'next/server';
import { getAgentRun, runAgent, scoreRun } from '@/lib/agentrun';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import { runIdFromWorkflowId } from '@/lib/temporal-visibility';

export const dynamic = 'force-dynamic';

// POST → re-run a durable workflow: re-dispatch the SAME agent+query as a fresh run. We correlate
// the Temporal workflowId back to the recorded run (the workflowId embeds the console runId) and
// re-submit through runAgent — which re-enters durable dispatch when it's enabled, or runs inline
// otherwise. This makes "rerun a job" work from the Jobs surface regardless of runtime.
//
// A rerun does not require Temporal to be reachable (the source run lives in the DB); that's why it
// reuses runAgent rather than a Temporal-only replay. The QA score runs after the response flushes.
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
  const prior = await getAgentRun(runId);
  if (!prior) {
    return NextResponse.json(
      { error: `no recorded run ${runId} correlated to this workflow` },
      { status: 404 },
    );
  }
  const run = await runAgent(prior.agentId, prior.query, gate.user.email ?? undefined, false, await currentOrgId());
  if (!run) return NextResponse.json({ error: 'unknown agent' }, { status: 404 });
  after(() => scoreRun(run));
  return NextResponse.json({ ok: true, run, sourceWorkflowId: workflowId }, { status: 201 });
}
