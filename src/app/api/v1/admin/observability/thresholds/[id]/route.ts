import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteThreshold, updateThreshold } from '@/lib/observability-settings';
import { degradeOn503 } from '@/lib/route-degrade';

export const dynamic = 'force-dynamic';

// PATCH (admin) — update a threshold rule (re-validated). DELETE (admin) — remove it.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  return degradeOn503(async () => {
    const r = await updateThreshold(id, b ?? {});
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  return degradeOn503(async () => {
    await deleteThreshold(id);
    return NextResponse.json({ ok: true });
  });
}
