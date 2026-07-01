import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getOrgSystemPrompt, setOrgSystemPrompt } from '@/lib/store';

// Org-wide system prompt — the highest-precedence instruction injected into every chat.
export async function GET() {
  return NextResponse.json({ systemPrompt: await getOrgSystemPrompt() });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    return NextResponse.json({ error: 'admin only' }, { status: 403 });
  }
  const b = (await req.json().catch(() => null)) as { systemPrompt?: unknown } | null;
  if (!b || typeof b.systemPrompt !== 'string') {
    return NextResponse.json({ error: 'systemPrompt (string) required' }, { status: 400 });
  }
  await setOrgSystemPrompt(b.systemPrompt, session.user.email ?? 'admin');
  return NextResponse.json({ ok: true });
}
