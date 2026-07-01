import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';

// Minimal run endpoint for the Studio "run as app" preview: send the end-user input through
// the gateway (the governed pipeline) and return the answer. Text path is real; richer
// triggers/sinks (file/email/whatsapp) are stubbed in the UI.
// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { input = '', system = '' } = await req.json().catch(() => ({ input: '' }));
  try {
    const r = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
    const output = data?.choices?.[0]?.message?.content ?? '';
    return NextResponse.json({ output });
  } catch (e) {
    return NextResponse.json({ output: '', error: (e as Error).message }, { status: 502 });
  }
}
