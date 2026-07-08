import { after, NextResponse } from 'next/server';
import { listAgentRuns, scoreRun } from '@/lib/agentrun';
import { dispatchAgentRun } from '@/lib/agent-run-dispatch';
import { actorFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { requireAdmin } from '@/lib/authz';
import { getChatBindingGovernance } from '@/lib/store';
import { resolveAgentBinding } from '@/lib/pipeline-run-glue';

// GET → recent agent run traces (steps + checks + provenance + citations).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listAgentRuns(15, await currentOrgId()) });
}

// POST { agentId, query } → execute an agent through the full interaction pipeline and record a
// traced run. Dispatch chooses the DURABLE Temporal path (when OFFGRID_QUEUE_ENABLED=1 /
// OFFGRID_ADAPTER_AGENTRUNTIME=temporal and the cluster is reachable) or the SYNCHRONOUS in-process
// path (the graceful default/fallback). The online QA score runs AFTER the response is flushed
// (next/server `after`), so the LLM-as-judge call never adds latency to the caller.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as
    | { agentId?: unknown; query?: unknown; project?: unknown }
    | null;
  if (!b || typeof b.agentId !== 'string' || typeof b.query !== 'string' || !b.query.trim()) {
    return NextResponse.json({ error: 'agentId and query required' }, { status: 400 });
  }

  const orgId = await currentOrgId();

  // PA-16b — resolve the bound-pipeline CONTRACT this agent run enforces (data allowlist + egress
  // leash + policy/guardrail overlay), most-specific-wins: an agent has no per-agent binding column
  // yet, so this is the org-default chat/consumer pipeline (null agent binding → org default). Null
  // (nothing bound / unresolvable) ⇒ the run behaves exactly as before (additive-only). Threaded
  // into dispatch → the sync RunContext so runAgent enforces it per PA-16b.
  const gov = await getChatBindingGovernance().catch(() => ({ defaultChatPipelineId: null, allowlist: [] }));
  const { contract, pipelineId } = await resolveAgentBinding(null, gov.defaultChatPipelineId, orgId);

  // C4: resolve the caller CONTEXT here — the request is the only place identity/org/project exist.
  // Pass the fully-resolved actor (machine vs user + label preserved, not just the email) so a
  // durable run in the worker attributes its four-plane fan-out exactly as an inline run would.
  const d = await dispatchAgentRun({
    agentId: b.agentId,
    query: b.query,
    caller: gate.user.email ?? undefined,
    orgId,
    actor: actorFromSession(gate),
    project: typeof b.project === 'string' && b.project.trim() ? b.project.trim() : undefined,
    contract,
    // PA-12: thread the resolved pipeline id so the run's observability trace is tagged at the source.
    pipelineId,
  });

  // Durable submit accepted but the pipeline is still executing in the worker — 202 with the
  // workflow/run id so the client can poll GET /runs until the run row appears.
  if (d.mode === 'pending') {
    return NextResponse.json(
      { status: 'running', runId: d.runId, workflowId: d.workflowId, run: d.run },
      { status: 202 },
    );
  }
  if (!d.run) return NextResponse.json({ error: 'unknown agent' }, { status: 404 });
  after(() => scoreRun(d.run!));
  return NextResponse.json(d.run, { status: 201 });
}
