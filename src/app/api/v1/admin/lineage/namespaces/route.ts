import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { createNamespace, marquezWriteConfigured } from '@/lib/lineage-writer';

export const dynamic = 'force-dynamic';

// POST (admin) — create/update a Marquez namespace. Marquez PUT is idempotent (create-or-update).
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  if (!marquezWriteConfigured()) {
    return NextResponse.json({ error: 'Marquez not configured' }, { status: 503 });
  }
  const b = (await req.json().catch(() => null)) as {
    name?: unknown;
    ownerName?: unknown;
    description?: unknown;
  } | null;
  const name = typeof b?.name === 'string' ? b.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const result = await createNamespace({
    name,
    ownerName: b?.ownerName,
    description: b?.description,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
