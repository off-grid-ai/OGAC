// SIEM log-shipping AND read-back. The audit log in Postgres is the source of truth; when
// OpenSearch is configured we ALSO ship each event to it for full-text search + SIEM dashboards.
// Shipping is fire-and-forget and best-effort — a SIEM outage never blocks or fails an audited
// request. Read-back (searchAudit) powers the console's Audit view: full-text + filtered search
// over the shipped stream, well beyond the 25-row Postgres slice on the Control page.
const OPENSEARCH_URL = process.env.OFFGRID_OPENSEARCH_URL;
const INDEX = process.env.OFFGRID_OPENSEARCH_INDEX ?? 'offgrid-audit';

interface Shippable {
  id: string;
  deviceId: string;
  model: string;
  outcome: string;
  tokens: number;
  leftDevice: boolean;
  keyId?: string | null;
  ts: string;
}

export function shipAudit(events: Shippable[]): void {
  if (!OPENSEARCH_URL || events.length === 0) return;
  // OpenSearch _bulk: alternating action + document lines, newline-delimited.
  const body =
    events
      .map(
        (e) => `${JSON.stringify({ index: { _index: INDEX, _id: e.id } })}\n${JSON.stringify(e)}`,
      )
      .join('\n') + '\n';
  fetch(`${OPENSEARCH_URL}/_bulk`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-ndjson' },
    body,
    signal: AbortSignal.timeout(4000),
  }).catch(() => {});
}

export function siemConfigured(): boolean {
  return Boolean(OPENSEARCH_URL);
}

export interface AuditSearchParams {
  q?: string; // free text (matched against model / outcome / deviceId / keyId)
  outcome?: string; // exact-match filter
  deviceId?: string; // exact-match filter
  size?: number;
  from?: number;
}

export interface AuditHit extends Shippable {
  score: number | null;
}

export interface AuditSearchResult {
  total: number;
  hits: AuditHit[];
  configured: boolean;
  error?: string;
}

interface OsHit {
  _id: string;
  _score: number | null;
  _source: Shippable;
}

// Build the OpenSearch query DSL: a bool query with a full-text `multi_match` (when `q` is given)
// plus term filters. Empty query → match_all, newest first.
// eslint-disable-next-line complexity
function buildQuery(p: AuditSearchParams): Record<string, unknown> {
  const must: Record<string, unknown>[] = [];
  const filter: Record<string, unknown>[] = [];
  if (p.q && p.q.trim()) {
    must.push({
      multi_match: {
        query: p.q.trim(),
        fields: ['model', 'outcome', 'deviceId', 'keyId'],
        type: 'best_fields',
        fuzziness: 'AUTO',
      },
    });
  }
  if (p.outcome) filter.push({ term: { 'outcome.keyword': p.outcome } });
  if (p.deviceId) filter.push({ term: { 'deviceId.keyword': p.deviceId } });
  const bool = must.length || filter.length ? { bool: { must, filter } } : { match_all: {} };
  return {
    query: bool,
    sort: [{ ts: { order: 'desc', unmapped_type: 'date' } }],
    size: Math.min(p.size ?? 50, 200),
    from: p.from ?? 0,
  };
}

// Read-back: full-text + filtered search over the shipped audit index. Best-effort — returns an
// error string (not a throw) so the view degrades gracefully when OpenSearch is down.
// eslint-disable-next-line complexity
export async function searchAudit(p: AuditSearchParams): Promise<AuditSearchResult> {
  if (!OPENSEARCH_URL) return { total: 0, hits: [], configured: false };
  try {
    const res = await fetch(`${OPENSEARCH_URL}/${INDEX}/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildQuery(p)),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { total: 0, hits: [], configured: true, error: `OpenSearch ${res.status}` };
    }
    const json = (await res.json()) as {
      hits?: { total?: { value?: number } | number; hits?: OsHit[] };
    };
    const totalRaw = json.hits?.total;
    const total = typeof totalRaw === 'number' ? totalRaw : (totalRaw?.value ?? 0);
    const hits = (json.hits?.hits ?? []).map((h) => ({ ...h._source, id: h._id, score: h._score }));
    return { total, hits, configured: true };
  } catch (e) {
    return { total: 0, hits: [], configured: true, error: (e as Error).message };
  }
}
