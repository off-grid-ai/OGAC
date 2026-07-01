import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteRoutingRule, setRoutingRuleEnabled } from '@/lib/store';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (!b || typeof b.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) required' }, { status: 400 });
  }
  await setRoutingRuleEnabled(id, b.enabled);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteRoutingRule(id);
  return NextResponse.json({ ok: true });
}
