import { NextResponse } from 'next/server';
import { computeStatus } from '@/lib/status';

export const dynamic = 'force-dynamic';

// PUBLIC status API — no auth, node-free. Tells consumers whether each Off Grid service is up
// and whether performance is good or degraded, plus an overall rollup. For uptime monitors,
// status pages, and health dashboards.
//
//   GET /api/v1/status
//   → { status: "operational|degraded|down", up, total,
//       services: [{ id, label, status: "up|down", performance: "good|degraded|unknown", ms }],
//       checkedAt }
//
// HTTP code mirrors health: 200 operational, 200 degraded, 503 when everything is down — so a
// plain `curl -f` / monitor treats a full outage as a failure.
export async function GET(): Promise<Response> {
  const summary = await computeStatus();
  const code = summary.status === 'down' ? 503 : 200;
  return NextResponse.json(summary, {
    status: code,
    headers: { 'cache-control': 'no-store' },
  });
}
