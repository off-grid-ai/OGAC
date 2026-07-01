import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteTool, setToolEnabled, setToolPolicy, type ToolPolicy } from '@/lib/store';

const POLICIES = ['allow', 'approval', 'blocked'];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { enabled?: unknown; policy?: unknown } | null;
  if (b && typeof b.policy === 'string' && POLICIES.includes(b.policy)) {
    await setToolPolicy(id, b.policy as ToolPolicy);
    return NextResponse.json({ ok: true });
  }
  if (b && typeof b.enabled === 'boolean') {
    await setToolEnabled(id, b.enabled);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(
    { error: 'enabled (boolean) or policy (allow|approval|blocked) required' },
    { status: 400 },
  );
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteTool(id);
  return NextResponse.json({ ok: true });
}
