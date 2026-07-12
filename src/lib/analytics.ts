import {
  analyticsScopeFilters,
  assembleAnalytics,
  emptyAnalytics,
  scopedQuery,
} from '@/lib/analytics-aggs';
import { type Analytics } from '@/lib/analytics-types';
import { type AuditEvent } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

// Analytics reads REAL gateway traffic from OpenSearch (index offgrid-gateway — the same durable
// sink the gateway usage/logs views use), NOT the seeded Postgres audit table. Empty or unreachable
// → real zeros, never synthetic.
//
// The rollups (byModel / time-series / percentiles / outcomes / drift / perf) are computed IN JS
// over the raw docs `gatewayEvents()` fetches — the SAME docs that feed the FinOps cost model and
// the stat cards — via the pure `assembleAnalytics()` (analytics-aggs.ts, zero-IO, unit-tested).
//
// WHY JS assembly and not an OpenSearch `date_histogram` (which we used to do): the day-series agg
// keyed off `@timestamp` returns ZERO buckets whenever that field is not mapped as a `date`, which
// flattened the per-day charts while the scalar sums feeding the cards still populated (#238). The
// scalar rollups derive from `tokens`/`ms` (always numeric) so the cards looked fine; only the
// histogram silently died. Bucketing days by `ts.slice(0,10)` in JS — exactly as FinOps' `daily`
// does — makes the charts bind to the same populated docs the cards do, mapping-independent.
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

// Compute the analytics rollups over the raw gateway docs (org- + pipeline-scoped by gatewayEvents).
// assembleAnalytics is pure + unit-tested; the day series buckets by `ts` in JS so the charts bind
// to the same populated docs the stat cards do, independent of the `@timestamp` field mapping (#238).
// Empty (no docs / OpenSearch unreachable — gatewayEvents returns []) → real zeros, never synthetic.
export async function computeAnalytics(pipelineTag?: string | null): Promise<Analytics> {
  const events = await gatewayEvents(pipelineTag);
  if (events.length === 0) return emptyAnalytics();
  return assembleAnalytics(events, Date.now());
}
