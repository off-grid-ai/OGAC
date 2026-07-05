import { NextResponse } from 'next/server';
import { getMdm } from '@/lib/adapters/registry';
import { requireAdmin } from '@/lib/authz';
import { validateOsquery } from '@/lib/fleetdm';

export const dynamic = 'force-dynamic';

// Run an osquery live query across selected hosts via the active MDM (FleetDM). The route is thin:
// it validates the SQL (pure logic) and delegates the campaign to the adapter.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => ({}))) as { query?: string; hostIds?: unknown };
  const sql = typeof body.query === 'string' ? body.query : '';
  const check = validateOsquery(sql);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const hostIds = Array.isArray(body.hostIds)
    ? body.hostIds.map((h) => Number(h)).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (hostIds.length === 0) {
    return NextResponse.json({ error: 'select at least one host' }, { status: 400 });
  }

  const mdm = getMdm();
  if (!mdm.supportsFleet || !mdm.liveQuery) {
    return NextResponse.json(
      { error: 'live query requires a FleetDM backend (set OFFGRID_ADAPTER_MDM=fleetdm)' },
      { status: 501 },
    );
  }
  try {
    const result = await mdm.liveQuery(sql, hostIds);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: `live query failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
