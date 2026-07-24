import {
  type Accounting,
  type RangePreset,
  buildAccountingQuery,
  emptyAccounting,
  parseAccountingResponse,
  resolveRange,
} from '@/lib/accounting-aggs';
import { currentOrgId } from '@/lib/tenancy';

// Usage & spend accounting — token usage + spend attributed PER USER, PER PROJECT/ORG, and PER
// MODEL over a time range, read from REAL gateway traffic in OpenSearch (index `offgrid-gateway`,
// the same durable sink Analytics/FinOps read). The rollups are computed by OpenSearch itself via a
// single `size:0` `_search` + `aggs` (native aggregation, not a JS loop) — see computeAccounting().
// Unreachable/empty → real zeros, never synthetic. The pure query builder + response parser live in
// accounting-aggs.ts (zero-IO, unit-tested). This is a thin I/O adapter that injects the clock + env
// and prices via finops.
import { opensearchFetch } from '@/lib/opensearch-http';

const OS_URL = process.env.OFFGRID_OPENSEARCH_URL ?? 'http://127.0.0.1:9200';
const OS_INDEX = process.env.OFFGRID_GATEWAY_INDEX ?? 'offgrid-gateway';

export type { Accounting, AttributedSpend, ModelSpend, RangePreset } from '@/lib/accounting-aggs';

/**
 * Compute the attributed usage/spend breakdown for a time-range preset via native OpenSearch
 * aggregations. Graceful fallback to real zeros when OpenSearch is unreachable.
 *
 * TENANT ISOLATION: the org is resolved INTERNALLY from the session/bearer (currentOrgId), never a
 * caller argument — so no route/page can forget to scope it (the SURFACE-3 leak was exactly a caller
 * that fetched orgId but never passed it down). Mirrors computeAnalytics.
 */
export async function computeAccounting(
  preset: RangePreset = 'all',
  pipelineTag?: string | null,
): Promise<Accounting> {
  const range = resolveRange(preset, Date.now());
  try {
    const org = await currentOrgId();
    const r = await opensearchFetch(`/${OS_INDEX}/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        buildAccountingQuery(range.from ?? undefined, range.to ?? undefined, pipelineTag, org),
      ),
      cache: 'no-store',
      timeoutMs: 6000,
    });
    if (!r.ok) return emptyAccounting(range);
    const data = await r.json();
    return parseAccountingResponse(data, range);
  } catch {
    return emptyAccounting(range);
  }
}
