import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

// Per-node control actions (activate/unload/pull/delete/settings) — proxied to the
// cluster gateway's /nodes/[name] endpoint, which speaks the node :7878 mgmt API.
// (The console can't reach LAN nodes directly under macOS Local Network privacy.)
const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:8800';

export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const body = await req.text();
  try {
    const r = await fetch(`${GATEWAY_URL}/nodes/${encodeURIComponent(name)}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(120000),
    });
    return NextResponse.json(await r.json().catch(() => ({})), { status: r.status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
