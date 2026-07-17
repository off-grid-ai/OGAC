import { NextResponse } from 'next/server';
import { gatewayControlFetch } from '@/lib/gateway';

export const dynamic = 'force-dynamic';

// The gateway (LiteLLM proxy) records every proxied call — per-gateway counters and a rolling log
// of recent requests. This route proxies that feed so the console can render live gateway traffic
// without the browser reaching the gateway directly. Returns null-ish shape when the gateway is a
// plain single node (no /traffic endpoint) so the UI can hide the panel.
export async function GET() {
  try {
    const r = await gatewayControlFetch('/traffic', {
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return NextResponse.json({ available: false }, { status: 200 });
    const data = await r.json();
    return NextResponse.json({ available: true, ...data });
  } catch {
    return NextResponse.json({ available: false }, { status: 200 });
  }
}
