import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { studioTemplates } from '@/db/schema';
import { runAgent } from '@/lib/agentrun';
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';
import type { Workflow } from '@/lib/studio';

export const dynamic = 'force-dynamic';

// Public run endpoint for a DEPLOYED Studio app (S2). No console session — the app is
// published — but it still executes through the governed pipeline (runAgent: ABAC + guardrails
// + grounding + Temporal) when the workflow has an Agent block. Only published templates run.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [tpl] = await db
    .select()
    .from(studioTemplates)
    .where(and(eq(studioTemplates.slug, slug), eq(studioTemplates.published, true)))
    .limit(1);
  if (!tpl) return NextResponse.json({ error: 'app not found' }, { status: 404 });

  const { input = '' } = (await req.json().catch(() => ({}))) as { input?: string };
  const wf = tpl.workflow as Workflow;
  const agentId = (wf.nodeIds ?? []).find((n) => n.startsWith('agent:'))?.replace(/^agent:/, '');

  try {
    if (agentId) {
      const run = await runAgent(agentId, String(input), `app:${slug}`);
      if (run) {
        return NextResponse.json({ output: run.answer, governed: true, status: run.status });
      }
    }
    // No agent block — plain governed-gateway completion seeded by the template summary.
    const r = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: gatewayHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        messages: [
          { role: 'system', content: tpl.summary || tpl.prompt },
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
