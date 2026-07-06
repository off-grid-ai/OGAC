import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { getOrgSystemPrompt, setOrgSystemPrompt } from '@/lib/store';

// Org-wide system prompt — the highest-precedence instruction injected into every chat.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ systemPrompt: await getOrgSystemPrompt() });
}

export async function PUT(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const session = await auth();
  if (session?.user?.role !== 'admin') {
    return NextResponse.json({ error: 'admin only' }, { status: 403 });
  }
  const b = (await req.json().catch(() => null)) as { systemPrompt?: unknown } | null;
  if (!b || typeof b.systemPrompt !== 'string') {
    return NextResponse.json({ error: 'systemPrompt (string) required' }, { status: 400 });
  }
  await setOrgSystemPrompt(b.systemPrompt, session.user.email ?? 'admin');
  auditFromSession(gate, await currentOrgId(), {
    action: 'org.settings.change',
    resource: 'org:system-prompt',
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true });
}
