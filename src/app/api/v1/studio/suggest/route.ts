import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';

export const dynamic = 'force-dynamic';

// Studio "infer from the description" (Phase 4.5). Given a plain-language goal + the org's available
// tools, ask the local gateway to (a) propose a crisp assistant name, (b) pick which tools are
// relevant, and (c) suggest whether it should use uploaded knowledge. Best-effort: any failure or
// junk returns empty suggestions so the builder just falls back to manual selection — never blocks.
interface SuggestBody {
  goal?: string;
  tools?: { id: string; name: string }[];
}

export async function POST(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => null)) as SuggestBody | null;
  const goal = (body?.goal ?? '').trim();
  const tools = Array.isArray(body?.tools) ? body!.tools.filter((t) => t?.id && t?.name) : [];
  if (goal.length < 10) {
    return NextResponse.json({ title: '', toolIds: [], grounded: null });
  }

  const toolList = tools.map((t) => `${t.id} — ${t.name}`).join('\n') || '(none available)';
  const sys =
    'You configure an AI assistant from a plain-language description. Respond with ONLY minified ' +
    'JSON: {"title":"","toolIds":[],"grounded":true}. ' +
    '"title": a short friendly name (max 6 words). ' +
    '"toolIds": ONLY ids from the provided tool list that the assistant clearly needs (empty if none). ' +
    '"grounded": true if the assistant should answer from uploaded documents/knowledge, false if it ' +
    'is a general/creative assistant that answers from the model.';

  try {
    const r = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: gatewayHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: `Description: ${goal}\n\nAvailable tools:\n${toolList}` },
        ],
        max_tokens: 300,
        temperature: 0,
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (r.ok) {
      const data = await r.json();
      const text: string = data?.choices?.[0]?.message?.content ?? '';
      const m = /\{[\s\S]*\}/.exec(text);
      if (m) {
        const parsed = JSON.parse(m[0]) as { title?: string; toolIds?: string[]; grounded?: boolean };
        const validIds = new Set(tools.map((t) => t.id));
        return NextResponse.json({
          title: typeof parsed.title === 'string' ? parsed.title.trim().slice(0, 48) : '',
          toolIds: Array.isArray(parsed.toolIds) ? parsed.toolIds.filter((id) => validIds.has(id)) : [],
          grounded: typeof parsed.grounded === 'boolean' ? parsed.grounded : null,
        });
      }
    }
  } catch {
    /* gateway unavailable — fall through to empty suggestion */
  }
  return NextResponse.json({ title: '', toolIds: [], grounded: null });
}
