import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { getCacheStatus } from '@/lib/adapters/litellm-cache';

export const dynamic = 'force-dynamic';

// Gateway response-cache status — the live /cache/ping result (type, reachable, enabled, healthy) +
// the read-only cache policy the proxy echoes (configured at deploy; reload required to change).
// Honest: configured:false when OFFGRID_LITELLM_URL is unset; reachable:false + error when the proxy
// or the cache API isn't there (404 on versions without it).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const status = await getCacheStatus();
  return NextResponse.json(status);
}
