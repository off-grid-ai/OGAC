import { NextResponse } from 'next/server';
import { geDataQuality } from '@/lib/adapters/data-quality';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// Admin data-quality probe — is the Great Expectations sidecar reachable, and which engine is it
// running (real GE vs the dependency-free fallback stub)? Best-effort: geDataQuality.health() never
// throws, so a { healthy, engine } envelope is always returned.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const h = await geDataQuality.health();
  return NextResponse.json({ healthy: h.healthy, engine: h.engine ?? null, url: h.url });
}
