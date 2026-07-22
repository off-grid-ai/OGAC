import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { getCacheStats } from '@/lib/adapters/litellm-cache';
import { parseRange } from '@/lib/litellm-spend';

export const dynamic = 'force-dynamic';

// Gateway cache observability — hit-rate + tokens/cost saved for a window (?range=24h|7d|30d),
// derived from LiteLLM's own /spend/logs cache_hit marker (READ-ONLY). Honest: markerUnavailable is
// true when the deployment doesn't stamp cache_hit, so the UI shows request volume instead of a
// fabricated hit-rate. costSaved is $0 on free on-prem models.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const range = parseRange(new URL(req.url).searchParams.get('range'));
  const result = await getCacheStats(range);
  return NextResponse.json({ range, ...result });
}
