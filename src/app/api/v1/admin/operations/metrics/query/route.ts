import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { instantQuery } from '@/lib/adapters/victoriametrics';
import { shapeChart } from '@/lib/victoriametrics-query';

export const dynamic = 'force-dynamic';

// GET /api/v1/admin/operations/metrics/query?q=<PromQL>&time=<unixSeconds?>
// Instant query → the latest-value readout + single-point chart. Shaping is the pure shapeChart.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (!q) return NextResponse.json({ error: 'q (PromQL) is required' }, { status: 400 });
  const timeRaw = url.searchParams.get('time');
  const time = timeRaw != null && timeRaw !== '' ? Number(timeRaw) : undefined;

  const result = await instantQuery(q, Number.isFinite(time) ? time : undefined);
  if (!result.configured) {
    return NextResponse.json({ configured: false, error: 'VictoriaMetrics is not configured' });
  }
  if (result.error) return NextResponse.json({ configured: true, error: result.error });
  return NextResponse.json({ configured: true, chart: shapeChart(q, '', result.response ?? null) });
}
