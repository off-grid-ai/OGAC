import { NextResponse } from 'next/server';
import { runAgent } from '@/lib/agentrun';
import { requireUser } from '@/lib/authz';
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';

export const dynamic = 'force-dynamic';

// Studio "run as app". When the composed workflow includes an Agent block, we run it
// through the REAL governed pipeline (runAgent): ABAC/policy gate → input guardrails →
// retrieval/grounding → answer → output guardrails → provenance signing → persistence →
// lineage → QA, and the Temporal queue when enabled. This is what makes Studio inherit the
// console's rule engine + workflow rather than just calling the model. Without an agent
// (e.g. a bare prompt preview), it falls back to a plain gateway completion.
// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { input = '', system = '', agentId: rawAgentId } = await req.json().catch(() => ({ input: '' }));
  const caller = gate.user.email ?? undefined;

  // Governed path — resolve the composed Agent block (id may arrive as "agent:foo").
  const agentId = typeof rawAgentId === 'string' ? rawAgentId.replace(/^agent:/, '') : '';
  if (agentId) {
    try {
      const run = await runAgent(agentId, String(input), caller);
      if (!run) return NextResponse.json({ output: '', error: `unknown agent "${agentId}"` }, { status: 404 });
      return NextResponse.json({
        output: run.answer,
        governed: true,
        status: run.status,               // ok | blocked | denied
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
