import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { currentPrincipal, provitAbacAllows } from '@/lib/provit-access';
import { askCopilot } from '@/lib/provit-intelligence';

export const dynamic = 'force-dynamic';

// POST /api/v1/provit/intelligence/chat — ask Provit's test COPILOT about a mapped repo.
// Provit answers on the console's own gateway (its oracle IS the console gateway), so this is the
// intelligence engine surfaced THROUGH the console: authenticated, ABAC-gated, thin.
//
// Body: { repo: string, messages: [{ role, content }] }. Provit streams SSE internally; the
// adapter assembles the reply so this route stays a simple request/response.
export async function POST(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const p = await currentPrincipal();
  if (!(await provitAbacAllows(p, 'read'))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as { repo?: string; messages?: { role?: string; content?: string }[] };
  const messages = (Array.isArray(b.messages) ? b.messages : [])
    .filter((m) => m && typeof m.content === 'string')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }));
  if (!messages.length) return NextResponse.json({ error: 'messages required' }, { status: 400 });

  const r = await askCopilot(String(b.repo ?? ''), messages);
  if (!r.ok) return NextResponse.json({ error: r.error ?? 'copilot unavailable', content: r.content }, { status: 502 });
  return NextResponse.json({ content: r.content }, { headers: { 'cache-control': 'no-store' } });
}
