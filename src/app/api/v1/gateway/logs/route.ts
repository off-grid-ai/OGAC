import { NextResponse, type NextRequest } from 'next/server';
import { analyticsScopeFilters } from '@/lib/analytics-aggs';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Gateway LOGS explorer — searchable/filterable history of every call the gateway handled.
// The gateway's observability sink ships each call to OpenSearch (index `offgrid-gateway`),
// so unlike /traffic (the in-memory live tail) this queries the durable full history with
// full-text search + structured filters + smart presets. Sits alongside /traffic; the
// gateway page renders both (live tail + this explorer). Falls back to available:false when
// OpenSearch is unreachable so the UI degrades gracefully.
const OS_URL = process.env.OFFGRID_OPENSEARCH_URL ?? 'http://127.0.0.1:9200';
const OS_INDEX = process.env.OFFGRID_GATEWAY_INDEX ?? 'offgrid-gateway';

// Status class → numeric range, so "5xx" etc. become a clean filter.
const STATUS_RANGE: Record<string, { gte: number; lte: number }> = {
  '2xx': { gte: 200, lte: 299 },
  '4xx': { gte: 400, lte: 499 },
  '5xx': { gte: 500, lte: 599 },
};

// eslint-disable-next-line complexity
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const q = p.get('q')?.trim();
  const size = Math.min(Number(p.get('size')) || 50, 200);
  const from = Math.max(Number(p.get('from')) || 0, 0);

  // TENANT ISOLATION (G-ADV-OBS-ORG): every logs query is scoped to the caller's org via an `org`
  // term — without it the explorer would surface another tenant's request bodies/outputs.
  const filter: unknown[] = [...analyticsScopeFilters(await currentOrgId())];
  for (const field of ['gateway', 'model', 'kind', 'caller'] as const) {
    const v = p.get(field);
    if (v) filter.push({ term: { [`${field}.keyword`]: v } });
  }
  const status = p.get('status');
  if (status && STATUS_RANGE[status]) filter.push({ range: { status: STATUS_RANGE[status] } });
  else if (status && /^\d+$/.test(status)) filter.push({ term: { status: Number(status) } });

  // Time window: sinceMs (e.g. last 15m) or explicit from/to ISO.
  const sinceMs = Number(p.get('sinceMs'));
  if (sinceMs > 0) filter.push({ range: { '@timestamp': { gte: `now-${Math.round(sinceMs / 1000)}s` } } });
  const tFrom = p.get('tFrom');
  const tTo = p.get('tTo');
  if (tFrom || tTo) filter.push({ range: { '@timestamp': { ...(tFrom ? { gte: tFrom } : {}), ...(tTo ? { lte: tTo } : {}) } } });

  // Smart preset: slow = latency over a threshold.
  const slowMs = Number(p.get('slowMs'));
  if (slowMs > 0) filter.push({ range: { ms: { gte: slowMs } } });
  if (p.get('tools') === '1') filter.push({ exists: { field: 'toolCalls' } });

  const must = q
    ? [{ multi_match: { query: q, fields: ['input', 'output', 'model', 'caller', 'gateway'], type: 'phrase_prefix' } }]
    : [{ match_all: {} }];

  const body = {
    size,
    from,
    sort: [{ '@timestamp': 'desc' }],
    query: { bool: { must, filter } },
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
    const hits = (data?.hits?.hits ?? []).map((h: { _source: Record<string, unknown> }) => h._source);
    const total = data?.hits?.total?.value ?? hits.length;
    return NextResponse.json({ available: true, total, size, from, hits });
  } catch {
    return NextResponse.json({ available: false }, { status: 200 });
  }
}
