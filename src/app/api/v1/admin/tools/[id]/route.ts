import { NextResponse } from 'next/server';
import { deleteTool, setToolEnabled } from '@/lib/store';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (!b || typeof b.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) required' }, { status: 400 });
  }
  await setToolEnabled(id, b.enabled);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteTool(id);
  return NextResponse.json({ ok: true });
}
