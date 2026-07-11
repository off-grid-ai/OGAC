import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// S7 iterative-refine loop (Bolt.new/Lovable core): given an artifact's current code + a
// plain-language instruction, return the FULL revised code. Runs on the on-prem gateway.
// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const code = typeof body.code === 'string' ? body.code : '';
  const instruction = typeof body.instruction === 'string' ? body.instruction : '';
  const kind = typeof body.kind === 'string' ? body.kind : 'html';
  const language = typeof body.language === 'string' ? body.language : '';
  if (!code.trim() || !instruction.trim()) {
    return NextResponse.json({ error: 'code and instruction required' }, { status: 400 });
  }

  const lang = language || (kind === 'react' ? 'jsx' : kind);
  const system =
    `You are an expert app builder. Given the CURRENT ${kind} source and a change request, ` +
    `return the COMPLETE updated source — no explanation, no markdown fences, just the raw ` +
    `${kind} code. Preserve everything not mentioned in the request. Keep it a single self-contained file.`;
  const prompt = `CURRENT ${kind.toUpperCase()} SOURCE:\n\`\`\`${lang}\n${code.slice(0, 24000)}\n\`\`\`\n\nCHANGE REQUEST:\n${instruction}\n\nReturn ONLY the full updated ${kind} source.`;

  try {
    const r = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: gatewayHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        max_tokens: 4096,
        temperature: 0.2,
        chat_template_kwargs: { enable_thinking: false },
        stream: false,
      }),
      signal: AbortSignal.timeout(110000),
    });
    if (!r.ok) return NextResponse.json({ error: `gateway ${r.status}` }, { status: 502 });
    const j = await r.json();
    let text: string = j?.choices?.[0]?.message?.content ?? '';
    // Strip a leading/trailing markdown fence if the model added one.
    const fence = /^\s*```[a-z]*\n([\s\S]*?)\n```\s*$/i.exec(text);
    if (fence) text = fence[1];
    return NextResponse.json({ code: text.trim() });
  } catch {
    return NextResponse.json({ error: 'gateway unreachable' }, { status: 502 });
  }
}
