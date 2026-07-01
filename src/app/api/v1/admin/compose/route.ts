import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { type Block, type Catalog, type Workflow, introspect } from '@/lib/studio';

export const dynamic = 'force-dynamic';

const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';

// Ask the local gateway to wire a workflow from the available blocks. Falls back to a
// deterministic pipeline if the model is unavailable or returns junk — the canvas always
// gets something coherent.
// eslint-disable-next-line complexity
async function modelPlan(prompt: string, catalog: Catalog, ids: Set<string>): Promise<Workflow | null> {
  const sys =
    'You wire an agentic workflow from a catalog of available building blocks. ' +
    'Each block has an id, a group (Connector|Data|Tool|Guardrail|Model|Agent), and a label. ' +
    'Given the user request, pick the blocks to use and the directed edges between them. ' +
    'Start with one Input (trigger), then Connector/Data sources -> Guardrails -> Tool/Agent -> Model, ' +
    'insert a Human (review) checkpoint before any irreversible Output, and end with an Output (sink). ' +
    'Respond with ONLY minified JSON: {"title":"","summary":"","nodeIds":[],"edges":[{"from":"","to":"","label":""}]}. ' +
    'Use ONLY ids that appear in the catalog.';
  const catalogText = catalog.blocks.map((b) => `${b.id} [${b.group}] ${b.label}`).join('\n');

  try {
    const r = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: `Request: ${prompt}\n\nCatalog:\n${catalogText}` },
        ],
        max_tokens: 700,
        temperature: 0,
        stream: false,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (r.ok) {
      const data = await r.json();
      const text: string = data?.choices?.[0]?.message?.content ?? '';
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        const wf = JSON.parse(m[0]) as Workflow;
        const nodeIds = (wf.nodeIds ?? []).filter((id) => ids.has(id));
        const edges = (wf.edges ?? []).filter((e) => ids.has(e.from) && ids.has(e.to));
        if (nodeIds.length) return { title: wf.title || 'Workflow', summary: wf.summary || prompt, nodeIds, edges };
      }
    }
  } catch {
    /* model unavailable */
  }
  return null;
}

async function plan(prompt: string, catalog: Catalog): Promise<Workflow> {
  const ids = new Set(catalog.blocks.map((b) => b.id));
  return (await modelPlan(prompt, catalog, ids)) ?? heuristic(prompt, catalog.blocks);
}

function heuristic(prompt: string, blocks: Block[]): Workflow {
  const byGroup = (g: Block['group'], n: number) => blocks.filter((b) => b.group === g).slice(0, n);
  const chain = [
    ...byGroup('Input', 1),
    ...byGroup('Connector', 1),
    ...byGroup('Data', 1),
    ...byGroup('Guardrail', 1),
    ...byGroup('Agent', 1),
    ...byGroup('Human', 1),
    ...byGroup('Output', 1),
  ];
  const edges = chain.slice(0, -1).map((b, i) => ({ from: b.id, to: chain[i + 1].id }));
  return { title: 'Suggested workflow', summary: prompt || 'Wired from available blocks', nodeIds: chain.map((b) => b.id), edges };
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { prompt = '' } = await req.json().catch(() => ({ prompt: '' }));
  const catalog = await introspect();
  const workflow = await plan(String(prompt), catalog);
  return NextResponse.json({ catalog, workflow });
}
