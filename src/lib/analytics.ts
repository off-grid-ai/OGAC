import {
  analyticsScopeFilters,
  buildAggsQuery,
  emptyAnalytics,
  parseAggsResponse,
  scopedQuery,
} from '@/lib/analytics-aggs';
import { type Analytics } from '@/lib/analytics-types';
import { type AuditEvent } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

// Analytics now reads REAL gateway traffic from OpenSearch (index offgrid-gateway — the same
// durable sink the gateway usage/logs views use), NOT the seeded Postgres audit table. Empty or
// unreachable → real zeros, never synthetic.
//
// The rollups (byModel / time-series / percentiles / outcomes / drift / perf) are computed by
// OpenSearch itself via a single `size:0` `_search` with `aggs` — see computeAnalytics(). We no
// longer pull up to 5000 raw docs and loop in JS for the rollups (correctness + scale). The pure
// query builder + response parser live in analytics-aggs.ts (zero-IO, unit-tested).
//
// gatewayEvents() (raw-doc fetch) is retained for the FinOps cost model (finops.ts), which needs
// per-event keyId/subject attribution the aggregation can't provide.
const OS_URL = process.env.OFFGRID_OPENSEARCH_URL ?? 'http://127.0.0.1:9200';
const OS_INDEX = process.env.OFFGRID_GATEWAY_INDEX ?? 'offgrid-gateway';

// Re-export the result types so existing `@/lib/analytics` importers are unchanged.
export type { Analytics, DayPoint, ModelStat, Signal } from '@/lib/analytics-types';

export async function gatewayEvents(pipelineTag?: string | null): Promise<AuditEvent[]> {
  // TENANT ISOLATION (G-ADV-OBS-ORG): scope the raw-doc read to the caller's org via an `org` term,
  // plus the optional pipeline narrowing (`project.keyword`). Without the org term a tenant's FinOps
  // cost model would count another tenant's traffic.
  const query = scopedQuery(analyticsScopeFilters(await currentOrgId(), pipelineTag));
  try {
    const r = await fetch(`${OS_URL}/${OS_INDEX}/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ size: 5000, sort: [{ '@timestamp': 'desc' }], query }),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return [];
    const data = await r.json();
    const hits: { _id?: string; _source?: Record<string, unknown> }[] = data?.hits?.hits ?? [];
    return hits.map((h, i) => {
      const s = h._source ?? {};
      const status = Number(s.status ?? 200);
      return {
        id: h._id ?? String(i),
        deviceId: String(s.caller ?? s.gateway ?? ''),
        ts: String(s['@timestamp'] ?? new Date(Number(s.ts ?? Date.now())).toISOString()),
        model: String(s.model ?? 'unknown'),
        tokens: Number(s.tokens ?? 0),
        leftDevice: false,
        tool: null,
        outcome: status >= 400 ? 'blocked' : 'ok',
        latencyMs: Number(s.ms ?? 0),
        keyId: null,
      } satisfies AuditEvent;
    });
  } catch {
    return [];
  }
}

// Compute the analytics rollups via native OpenSearch aggregations — one `size:0` `_search`, no raw
// docs. Graceful fallback to real zeros when OpenSearch is unreachable (identical to the old empty
// path). The output shape is byte-identical to the previous JS-loop implementation.
export async function computeAnalytics(pipelineTag?: string | null): Promise<Analytics> {
  try {
    // TENANT ISOLATION (G-ADV-OBS-ORG): scope the whole aggregation to the caller's org.
    const org = await currentOrgId();
    const r = await fetch(`${OS_URL}/${OS_INDEX}/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildAggsQuery(Date.now(), pipelineTag, org)),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return emptyAnalytics();
    const data = await r.json();
    return parseAggsResponse(data);
  } catch {
    return emptyAnalytics();
  }
}
