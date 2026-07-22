import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { rangeQuery } from '@/lib/adapters/victoriametrics';
import { normalizeRange, rangeToParams, shapeChart } from '@/lib/victoriametrics-query';

export const dynamic = 'force-dynamic';

// GET /api/v1/admin/operations/metrics/query-range?q=<PromQL>&range=<15m|1h|6h|24h|7d>
// Range query → the time-series chart. The window→{start,end,step} arithmetic is pure.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (!q) return NextResponse.json({ error: 'q (PromQL) is required' }, { status: 400 });
  const range = normalizeRange(url.searchParams.get('range'));

  const result = await rangeQuery(q, rangeToParams(range));
  if (!result.configured) {
    return NextResponse.json({ configured: false, error: 'VictoriaMetrics is not configured' });
  }
  if (result.error) return NextResponse.json({ configured: true, range, error: result.error });
  return NextResponse.json({
    configured: true,
    range,
    chart: shapeChart(q, '', result.response ?? null),
  });
}
