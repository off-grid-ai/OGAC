import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Gateway CONTROL plane — per-node model view for load/unload/switch/pull/delete.
// The console PROXIES the cluster gateway's /nodes endpoint rather than reaching
// node :7878 APIs directly: the gateway runs where it can reach the LAN nodes,
// whereas the console (a macOS user LaunchAgent) is blocked from LAN peers by
// Local Network privacy. So the gateway fronts model management; we forward.
const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';

export async function GET() {
  try {
    const r = await fetch(`${GATEWAY_URL}/nodes`, { cache: 'no-store', headers: { 'x-api-key': process.env.OFFGRID_GATEWAY_API_KEY ?? '' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return NextResponse.json({ available: false, nodes: [] }, { status: 200 });
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json({ available: false, nodes: [] }, { status: 200 });
  }
}
