import { FinopsStore, toFinopsReport, type TrafficRecord } from '@offgrid/finops';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Gateway COST / FinOps — reads the durable call history from OpenSearch (index
// `offgrid-gateway`, same sink as /logs) for the last 24h, replays each record through a fresh
// FinopsStore, and returns a plain FinopsReport (byModel/byCaller/daily/projectedMonthly/totals)
// the finops plane renders directly. Local models are priced at an estimated blended rate.
// Degrades to available:false when OpenSearch is unreachable (mirrors /logs).
const OS_URL = process.env.OFFGRID_OPENSEARCH_URL ?? 'http://offgrid-s1.local:9200';
const OS_INDEX = process.env.OFFGRID_GATEWAY_INDEX ?? 'offgrid-gateway';

export async function GET() {
  const body = {
    size: 5000,
    sort: [{ '@timestamp': 'desc' }],
    query: { bool: { filter: [{ range: { '@timestamp': { gte: 'now-24h' } } }] } },
  };

  try {
    const r = await fetch(`${OS_URL}/${OS_INDEX}/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return NextResponse.json({ available: false }, { status: 200 });
    const data = await r.json();
    const hits = (data?.hits?.hits ?? []).map(
      (h: { _source: Record<string, unknown> }) => h._source as unknown as TrafficRecord,
    );

    const store = new FinopsStore();
    for (const rec of hits) store.ingest(rec);

    return NextResponse.json({ available: true, ...toFinopsReport(store) });
  } catch {
    return NextResponse.json({ available: false }, { status: 200 });
  }
}
