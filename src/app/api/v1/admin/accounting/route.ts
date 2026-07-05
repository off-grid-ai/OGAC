import { NextResponse, type NextRequest } from 'next/server';
import { computeAccounting } from '@/lib/accounting';
import { isRangePreset } from '@/lib/accounting-aggs';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// Usage & spend accounting — token usage + spend attributed per user, per project/org, and per
// model over a time range. `?range=24h|7d|30d|90d|all` (default all). Native OpenSearch aggregation
// behind computeAccounting(); ADDITIVE to Analytics/FinOps, which are untouched.
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const raw = req.nextUrl.searchParams.get('range') ?? 'all';
  const range = isRangePreset(raw) ? raw : 'all';
  return NextResponse.json(await computeAccounting(range));
}
