import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteTenant, setTenantModules } from '@/lib/store';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!Array.isArray(body?.enabledModules)) {
    return NextResponse.json({ error: 'enabledModules (array) required' }, { status: 400 });
  }
  const t = await setTenantModules(id, body.enabledModules);
  if (!t) {
    return NextResponse.json({ error: 'unknown tenant' }, { status: 404 });
  }
  return NextResponse.json(t);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteTenant(id);
  return NextResponse.json({ deleted: true });
}
