import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { getSpendLogRows } from '@/lib/adapters/litellm-spend';
import { parseRange } from '@/lib/litellm-spend';

export const dynamic = 'force-dynamic';

// The per-request spend drill-down list (?range=, optional ?limit=). Most-recent first; the raw key
// token is masked to last-4 in the pure normalizer, never returned in full.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const params = new URL(req.url).searchParams;
  const range = parseRange(params.get('range'));
  const limitRaw = Number(params.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, Math.floor(limitRaw)) : 100;
  const result = await getSpendLogRows(range);
  return NextResponse.json({
    object: 'list',
    configured: result.configured,
    live: result.live,
    ...(result.error ? { error: result.error } : {}),
    data: result.rows.slice(0, limit),
  });
}
