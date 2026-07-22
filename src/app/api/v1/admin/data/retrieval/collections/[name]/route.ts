import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { qdrantSnapshots } from '@/lib/adapters/qdrant-snapshots';
import { validateCollectionName } from '@/lib/qdrant-snapshots';

export const dynamic = 'force-dynamic';

// Collection detail — status, points/vectors counts, vector config. Admin-only (viewer may GET).
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name } = await params;
  const v = validateCollectionName(name);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  try {
    return NextResponse.json(await qdrantSnapshots.getCollection(name));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
