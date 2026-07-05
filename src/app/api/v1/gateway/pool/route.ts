import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/db';
import { fleetNodes } from '@/db/schema';
import { derivePool, type FleetNode } from '@/lib/fleet';

export const dynamic = 'force-dynamic';

// The aggregator (scripts/gateway-aggregator.mjs) fetches this on startup + on a
// refresh interval to build its routing POOL/IMAGE_POOL from the fleet_nodes SSOT.
// Read-only. If this is unreachable the aggregator falls back to its hardcoded
// POOL, so routing can never go down because of the DB/console.
//
// Auth: the gateway API key via x-api-key (the aggregator already holds it). Topology
// isn't secret, but we gate writes-adjacent surfaces consistently.
export async function GET(req: NextRequest) {
  const key = process.env.OFFGRID_GATEWAY_API_KEY ?? '';
  if (key && (req.headers.get('x-api-key') ?? '') !== key) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const rows = await db.select().from(fleetNodes);
    const nodes: FleetNode[] = rows.map((r) => ({
      name: r.name,
      host: r.host,
      port: r.port,
      role: r.role as FleetNode['role'],
      kind: r.kind as FleetNode['kind'],
      model: r.model,
      primaryGguf: r.primaryGguf,
      mmprojGguf: r.mmprojGguf,
      modelId: r.modelId,
      contextSize: r.contextSize,
      vision: r.vision,
      enabled: r.enabled,
      notes: r.notes,
    }));
    return NextResponse.json({ ...derivePool(nodes), count: nodes.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
