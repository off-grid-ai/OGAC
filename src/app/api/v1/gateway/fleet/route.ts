import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/db';
import { fleetNodes } from '@/db/schema';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// Fleet SSOT — the full node rows the config editor reads/writes. This is the
// authoritative topology (aggregator routing + status page derive from it). Admin only.
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const rows = await db.select().from(fleetNodes);
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ nodes: rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, nodes: [] }, { status: 500 });
  }
}
