import { NextResponse } from 'next/server';
import { scrapeAuthorized } from '@/lib/exporters/config';
import { renderPromText } from '@/lib/exporters/prometheus';
import { finOpsToSamples } from '@/lib/exporters/registry';
import { computeFinOps } from '@/lib/finops';

export const dynamic = 'force-dynamic';

// Prometheus SCRAPE endpoint (M6 metrics exporter, pull mode). The enterprise's Prometheus scrapes
// this and Grafana dashboards render the platform's cost/usage. Gated by a shared bearer token
// (OFFGRID_METRICS_SCRAPE_TOKEN, or the admin token) so it isn't world-readable. The body is the
// pure Prometheus text-exposition rendering of the SAME finops rollup the console shows — the
// numbers match by construction.
export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const presented = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const ok = scrapeAuthorized(presented, {
    scrapeToken: process.env.OFFGRID_METRICS_SCRAPE_TOKEN,
    adminToken: process.env.OFFGRID_ADMIN_TOKEN,
  });
  if (!ok) {
    return NextResponse.json(
      { error: 'unauthorized — present the metrics scrape token as a Bearer credential' },
      { status: 401 },
    );
  }

  const finops = await computeFinOps();
  const body = renderPromText(finOpsToSamples(finops));
  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
  });
}
