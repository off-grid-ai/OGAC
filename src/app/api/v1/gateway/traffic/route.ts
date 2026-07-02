import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// The gateway aggregator (S1 :8800) records every proxied call — per-gateway counters and a
// rolling log of recent requests. This route proxies that feed so the console can render live
// gateway traffic without the browser reaching the aggregator directly. Returns null-ish shape
// when the gateway is a plain single node (no /traffic endpoint) so the UI can hide the panel.
const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';

export async function GET() {
  try {
    const r = await fetch(`${GATEWAY_URL}/traffic`, {
      cache: 'no-store',
      headers: { 'x-api-key': process.env.OFFGRID_GATEWAY_API_KEY ?? '' },
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return NextResponse.json({ available: false }, { status: 200 });
    const data = await r.json();
    return NextResponse.json({ available: true, ...data });
  } catch {
    return NextResponse.json({ available: false }, { status: 200 });
  }
}
