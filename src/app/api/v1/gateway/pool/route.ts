import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/db';
import { fleetNodes } from '@/db/schema';
import { derivePool, mapFleetNodeRow } from '@/lib/fleet';

export const dynamic = 'force-dynamic';

// The aggregator (scripts/gateway-aggregator.mjs) fetches this on startup + on a
// refresh interval to build its routing POOL/IMAGE_POOL from the fleet_nodes SSOT.
// Read-only. If this is unreachable the aggregator falls back to its hardcoded
// POOL, so routing can never go down because of the DB/console.
//
// No key gate: this returns only non-secret topology (node names/models/.local hosts),
// the aggregator calls it from localhost on S1, and external access already passes the
// tunnel's Keycloak/oauth2-proxy gate. (A build-time-inlined OFFGRID_GATEWAY_API_KEY
// made an x-api-key gate unreliable across separate build environments.)
export async function GET(_req: NextRequest) {
  try {
    const rows = await db.select().from(fleetNodes);
    const nodes = rows.map(mapFleetNodeRow);
    return NextResponse.json({ ...derivePool(nodes), count: nodes.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
