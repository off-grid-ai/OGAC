import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { qdrantSnapshots } from '@/lib/adapters/qdrant-snapshots';

export const dynamic = 'force-dynamic';

// List Qdrant collections with a best-effort status/points-count readout. Admin-only (viewer may GET).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const collections = await qdrantSnapshots.listCollections();
    return NextResponse.json({ configured: true, collections });
  } catch (e) {
    // Not-configured / unreachable Qdrant → honest empty state, not a 500 that breaks the page.
    return NextResponse.json({ configured: false, collections: [], error: (e as Error).message });
  }
}
