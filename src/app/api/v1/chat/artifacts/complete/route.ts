import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// AI bridge for artifact apps. The sandboxed artifact iframe exposes window.offgrid.complete()
// which POSTs here; we proxy a single completion to the on-prem gateway and return the text.
// This is the ONLY egress an artifact gets: no external network, no persistent storage. The
// call runs on the same LAN gateway the chat uses, so nothing leaves the deployment.
// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt.trim()) return NextResponse.json({ error: 'prompt required' }, { status: 400 });

  // Cap the surface an untrusted artifact can drive: bounded tokens, optional system, no tools.
  const maxTokens = Math.min(Math.max(Number(body.max_tokens) || 512, 1), 2048);
  const messages: Array<{ role: string; content: string }> = [];
  if (typeof body.system === 'string' && body.system.trim()) {
    messages.push({ role: 'system', content: body.system.slice(0, 4000) });
  }
  messages.push({ role: 'user', content: prompt.slice(0, 16000) });

  const payload: Record<string, unknown> = {
    messages,
    max_tokens: maxTokens,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
    chat_template_kwargs: { enable_thinking: false },
  };
  if (typeof body.model === 'string' && body.model) payload.model = body.model;

  try {
    const r = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: gatewayHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(50000),
    });
    if (!r.ok) return NextResponse.json({ error: `gateway ${r.status}` }, { status: 502 });
    const j = await r.json();
    const text: string = j?.choices?.[0]?.message?.content ?? '';
    return NextResponse.json({ text });
  } catch {
    return NextResponse.json({ error: 'gateway unreachable' }, { status: 502 });
  }
}
