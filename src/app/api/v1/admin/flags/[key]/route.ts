import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteFlag } from '@/lib/store';

export async function DELETE(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { key } = await params;
  const ok = await deleteFlag(decodeURIComponent(key));
  if (!ok) return NextResponse.json({ error: 'unknown flag' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
