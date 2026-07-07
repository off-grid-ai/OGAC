import { NextResponse } from 'next/server';
import { dispatchAgentRun } from '@/lib/agent-run-dispatch';
import { actorFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { requireUser } from '@/lib/authz';
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';

export const dynamic = 'force-dynamic';

// Studio "run as app". When the composed workflow includes an Agent block, we run it through the
// REAL governed pipeline via dispatchAgentRun: ABAC/policy gate → input guardrails →
// retrieval/grounding → answer → output guardrails → provenance signing → persistence → lineage →
// QA. Dispatch selects the DURABLE Temporal path when OFFGRID_QUEUE_ENABLED=1 /
// OFFGRID_ADAPTER_AGENTRUNTIME=temporal and the cluster is reachable — so a Studio test-run survives
// a restart and is resumable/cancelable — or degrades gracefully to the synchronous in-process path.
// This is what makes Studio inherit the console's rule engine + workflow rather than just calling the
// model. Without an agent (e.g. a bare prompt preview), it falls back to a plain gateway completion.
// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { input = '', system = '', agentId: rawAgentId, requireReview = false } = await req.json().catch(() => ({ input: '' }));
  const caller = gate.user.email ?? undefined;

  // Governed path — resolve the composed Agent block (id may arrive as "agent:foo").
  const agentId = typeof rawAgentId === 'string' ? rawAgentId.replace(/^agent:/, '') : '';
  if (agentId) {
    try {
      const d = await dispatchAgentRun({
        agentId,
        query: String(input),
        caller,
        requireReview: !!requireReview,
        orgId: await currentOrgId(),
        actor: actorFromSession(gate),
      });
      // Durable submit accepted but the pipeline is still executing in the worker — surface the ids
      // + mode honestly so the Studio UI can poll for the run rather than assume a synchronous answer.
      if (d.mode === 'pending') {
        return NextResponse.json(
          { output: '', governed: true, mode: 'durable', status: 'running', runId: d.runId, workflowId: d.workflowId },
          { status: 202 },
        );
      }
      const run = d.run;
      if (!run) return NextResponse.json({ output: '', error: `unknown agent "${agentId}"` }, { status: 404 });
      return NextResponse.json({
        output: run.answer,
        governed: true,
        mode: d.mode,                     // 'durable' (ran on the worker) | 'sync' (in-process) — honest
        runId: run.id,                    // for the human-review approve/reject endpoint
        status: run.status,               // done | pending_review | blocked | denied
        steps: run.steps,                 // policy / guard / retrieve / answer / ground / sign …
        checks: run.checks,               // guardrail verdicts
        citations: run.citations,
      });
    } catch (e) {
      return NextResponse.json({ output: '', error: (e as Error).message }, { status: 502 });
    }
  }

  // Fallback — no agent block: plain governed-gateway completion (still keyed).
  try {
    const r = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: gatewayHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        messages: [
          ...(system ? [{ role: 'system', content: String(system) }] : []),
          { role: 'user', content: String(input) },
        ],
        max_tokens: 400,
        stream: false,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) return NextResponse.json({ output: '', error: `gateway ${r.status}` }, { status: 502 });
    const data = await r.json();
    return NextResponse.json({ output: data?.choices?.[0]?.message?.content ?? '', governed: false });
  } catch (e) {
    return NextResponse.json({ output: '', error: (e as Error).message }, { status: 502 });
  }
}
