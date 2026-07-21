import { after, NextResponse } from 'next/server';
import { dispatchAgentRun } from '@/lib/agent-run-dispatch';
import { AgentPipelineBindingError } from '@/lib/pipeline-run-glue';
import { askerFrom } from '@/lib/retrieval/acl';
import { listAgentRuns, scoreRun } from '@/lib/agentrun';
import { callerFromSession } from '@/lib/app-access-caller';
import { enforceAppAccessWithSharing } from '@/lib/app-sharing';
import { actorFromSession, auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { getCustomAgent } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

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
  const b = (await req.json().catch(() => null)) as {
    agentId?: unknown;
    query?: unknown;
    project?: unknown;
  } | null;
  if (!b || typeof b.agentId !== 'string' || typeof b.query !== 'string' || !b.query.trim()) {
    return NextResponse.json({ error: 'agentId and query required' }, { status: 400 });
  }

  const orgId = await currentOrgId();

  // Per-agent ACCESS CONTROL — every agent (a consumer) is governed. A custom agent has no owner
  // column, so an unbound policy is least-privilege (admins only). The query is the ABAC attribute
  // surface. Denied → 403 + reason, audited access.denied. Only enforced for a known custom agent;
  // a built-in/unknown id falls through to dispatch's own 404 (additive, never breaks existing IDs).
  const agent = await getCustomAgent(b.agentId, orgId);
  if (agent) {
    const caller = await callerFromSession(gate, orgId);
    const access = await enforceAppAccessWithSharing({
      appId: b.agentId,
      orgId,
      ownerId: '',
      caller,
      action: 'run',
      requestAttrs: { query: b.query },
    });
    if (!access.allow) {
      auditFromSession(gate, orgId, {
        action: 'access.denied',
        resource: `agent:${b.agentId} run`,
        outcome: 'blocked',
      });
      return NextResponse.json({ error: 'access denied', reason: access.reason }, { status: 403 });
    }
  }

  // C4: resolve the caller CONTEXT here — the request is the only place identity/org/project exist.
  // Pass the fully-resolved actor (machine vs user + label preserved, not just the email) so a
  // durable run in the worker attributes its four-plane fan-out exactly as an inline run would.
  let d;
  try {
    d = await dispatchAgentRun({
      agentId: b.agentId,
      query: b.query,
      caller: gate.user.email ?? undefined,
      orgId,
      actor: actorFromSession(gate),
      project: typeof b.project === 'string' && b.project.trim() ? b.project.trim() : undefined,
      asker: askerFrom({ email: gate.user.email, role: gate.user.role }),
    });
  } catch (error) {
    if (!(error instanceof AgentPipelineBindingError)) throw error;
    const status =
      error.binding.code === 'agent_not_found'
        ? 404
        : error.binding.state === 'unavailable'
          ? 503
          : 409;
    return NextResponse.json(
      {
        error:
          error.binding.code === 'agent_not_found' ? 'unknown agent' : 'agent binding unavailable',
        reason: error.message,
        binding: error.binding.state,
      },
      { status },
    );
  }

  // Durable submit accepted but the pipeline is still executing in the worker — 202 with the
  // workflow/run id so the client can poll GET /runs until the run row appears.
  if (d.mode === 'pending') {
    return NextResponse.json(
      { status: 'running', runId: d.runId, workflowId: d.workflowId, run: d.run },
      { status: 202 },
    );
  }
  if (!d.run) return NextResponse.json({ error: 'unknown agent' }, { status: 404 });
  after(() => scoreRun(d.run!, orgId));
  return NextResponse.json(d.run, { status: 201 });
}
