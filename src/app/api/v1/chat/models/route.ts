import { NextResponse } from 'next/server';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';

// The models the chat model-picker offers — proxied from the gateway/aggregator so the browser
// never hits it directly. Falls back to a single default if the gateway doesn't enumerate.
export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const r = await fetch(`${GATEWAY_URL}/v1/models`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    const models = (data?.data ?? []).map((m: { id: string; capabilities?: string[] }) => ({
      id: m.id,
      vision: (m.capabilities ?? []).includes('vision'),
    }));
    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({ models: [] });
  }
}
