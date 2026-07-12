// PURE SIEM/security-events display-model normalizer — zero imports, zero I/O, fully unit-testable.
//
// The gateway/audit pipeline lands security & audit events in OpenSearch (index OFFGRID_SIEM_INDEX).
// Records are loosely shaped: field names vary by producer (actor/user/subject, action/event/type,
// outcome/result/status), timestamps live under a couple of keys, and arrays may be absent. This
// module turns raw OpenSearch hits into one clean display model — events newest-first plus rollups
// (counts by outcome, top actors, blocked/denied count). The network read lives in a thin
// best-effort reader (readSiemView, below); this file never fetches.

// ── Raw OpenSearch shapes (only the fields we read; everything optional/defensive) ─────────────
export interface RawSiemHit {
  _id?: string;
  _source?: Record<string, unknown>;
}

export interface RawSiemResponse {
  hits?: { hits?: RawSiemHit[] };
}

// ── Display model ──────────────────────────────────────────────────────────────────────────────
export type SiemOutcome = 'allowed' | 'denied' | 'blocked' | 'error' | 'unknown';

export interface SiemEvent {
  id: string;
  ts: string; // ISO-8601, or '' when absent/unparseable
  actor: string;
  action: string;
  outcome: SiemOutcome;
  ip: string;
  detail: string;
}

export interface OutcomeCount {
  outcome: SiemOutcome;
  count: number;
}

export interface ActorCount {
  actor: string;
  count: number;
}

export interface SiemView {
  total: number;
  events: SiemEvent[];
  byOutcome: OutcomeCount[];
  topActors: ActorCount[];
  blockedDenied: number; // events whose outcome is 'blocked' or 'denied'
}

// ── Helpers (pure) ───────────────────────────────────────────────────────────────────────────
function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Structured field (e.g. the audit `actor` is shipped as {type,id,label}, not a bare string).
  // Read a human-meaningful leaf so the SIEM row shows "Priya Nair" / the email, not "unknown".
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['label', 'name', 'email', 'id', 'value']) {
      const leaf = o[k];
      if (typeof leaf === 'string' && leaf.trim()) return leaf.trim();
    }
  }
  return '';
}

// First non-empty string among candidate source keys.
function pick(s: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = str(s[k]);
    if (v) return v;
  }
  return '';
}

// Normalize a producer's outcome/result/status word into our closed set. Falls back to an
// HTTP-ish status code when no explicit verdict word is present.
export function classifyOutcome(raw: string, status: number): SiemOutcome {
  const v = raw.toLowerCase();
  if (['deny', 'denied', 'reject', 'rejected', 'forbidden', 'unauthorized'].includes(v))
    return 'denied';
  if (['block', 'blocked', 'quarantined'].includes(v)) return 'blocked';
  if (['allow', 'allowed', 'success', 'ok', 'permit', 'permitted'].includes(v)) return 'allowed';
  if (['error', 'failed', 'failure'].includes(v)) return 'error';
  if (status >= 500) return 'error';
  if (status === 401 || status === 403) return 'denied';
  if (status >= 400) return 'blocked';
  if (status >= 200 && status < 400) return 'allowed';
  return 'unknown';
}

function normalizeTs(s: Record<string, unknown>): string {
  const raw = pick(s, ['@timestamp', 'timestamp', 'time', 'eventTime', 'ts']);
  if (!raw) {
    const epoch = Number(s.ts);
    if (Number.isFinite(epoch) && epoch > 0) {
      const d = new Date(epoch < 1e12 ? epoch * 1000 : epoch);
      return Number.isNaN(d.getTime()) ? '' : d.toISOString();
    }
    return '';
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function toEvent(hit: RawSiemHit, index: number): SiemEvent {
  const s = hit._source ?? {};
  const status = Number(s.status ?? s.statusCode ?? s.code ?? 0) || 0;
  const rawOutcome = pick(s, ['outcome', 'result', 'verdict', 'decision', 'action_result']);
  return {
    id: str(hit._id) || `evt-${index}`,
    ts: normalizeTs(s),
    actor:
      pick(s, ['actor', 'user', 'username', 'subject', 'principal', 'caller', 'email']) || 'unknown',
    action: pick(s, ['action', 'event', 'eventType', 'operation', 'type', 'message']) || 'unknown',
    outcome: classifyOutcome(rawOutcome, status),
    ip: pick(s, ['ip', 'sourceIp', 'source_ip', 'clientIp', 'client_ip', 'remoteAddr']),
    detail: pick(s, ['detail', 'description', 'reason', 'path', 'resource', 'message']),
  };
}

const OUTCOME_ORDER: SiemOutcome[] = ['denied', 'blocked', 'error', 'allowed', 'unknown'];

// ── The pure normalizer: raw response (or bare hits array, or null) → display model ────────────
export function normalizeSiem(input: RawSiemResponse | RawSiemHit[] | null | undefined): SiemView {
  const hits: RawSiemHit[] = Array.isArray(input) ? input : (input?.hits?.hits ?? []);

  const events = hits.map((h, i) => toEvent(h, i));
  // Newest-first; events without a timestamp sort to the end.
  events.sort((a, b) => {
    if (a.ts && b.ts) return b.ts.localeCompare(a.ts);
    if (a.ts) return -1;
    if (b.ts) return 1;
    return 0;
  });

  const outcomeMap = new Map<SiemOutcome, number>();
  const actorMap = new Map<string, number>();
  for (const e of events) {
    outcomeMap.set(e.outcome, (outcomeMap.get(e.outcome) ?? 0) + 1);
    actorMap.set(e.actor, (actorMap.get(e.actor) ?? 0) + 1);
  }

  const byOutcome: OutcomeCount[] = OUTCOME_ORDER.filter((o) => outcomeMap.has(o)).map((o) => ({
    outcome: o,
    count: outcomeMap.get(o) ?? 0,
  }));

  const topActors: ActorCount[] = [...actorMap.entries()]
    .map(([actor, count]) => ({ actor, count }))
    .sort((a, b) => b.count - a.count || a.actor.localeCompare(b.actor))
    .slice(0, 10);

  const blockedDenied = events.filter(
    (e) => e.outcome === 'blocked' || e.outcome === 'denied',
  ).length;

  return { total: events.length, events, byOutcome, topActors, blockedDenied };
}

// Apply an optional outcome filter to an already-normalized view, recomputing the events list and
// blocked/denied tally while leaving the rollups (byOutcome, topActors) reflecting the full set —
// so the filter chips can always show every outcome's total. Pure; used by the URL-driven page.
export function filterByOutcome(view: SiemView, outcome?: string): SiemView {
  const valid = OUTCOME_ORDER.includes(outcome as SiemOutcome) ? (outcome as SiemOutcome) : null;
  if (!valid) return view;
  const events = view.events.filter((e) => e.outcome === valid);
  return {
    ...view,
    events,
    blockedDenied: events.filter((e) => e.outcome === 'blocked' || e.outcome === 'denied').length,
  };
}

// ── Index resolution (pure) ────────────────────────────────────────────────────────────────────
// The attributed governance audit stream ships to `offgrid-audit` (see siem.ts / OFFGRID_OPENSEARCH_INDEX),
// NOT `offgrid-security`. Historically this reader defaulted to `offgrid-security`, so the SIEM page
// could render empty while the real attributed audit stream sat in offgrid-audit. We now default the
// SIEM READ to where that data actually lands (`offgrid-audit`), and accept a comma-separated index
// list so an operator can point it at both (or a legacy security index) without code changes.
//
//   OFFGRID_SIEM_INDEX  — comma-separated index/alias list the SIEM page reads (default: offgrid-audit).
//                         OpenSearch multi-target search accepts `a,b` in the path, so
//                         `offgrid-audit,offgrid-security` reads both. If unset, falls back to
//                         OFFGRID_OPENSEARCH_INDEX (the ship-side index) then the hardcoded default —
//                         so the read tracks wherever the audit stream is shipped, with zero config.
export const DEFAULT_SIEM_INDEX = 'offgrid-audit';

// Resolve the index path segment from env: prefer the explicit SIEM read var, then the ship-side
// index var, then the hardcoded default. Trims/dedupes the comma list and URL-encodes each target
// (commas stay literal so OpenSearch multi-target search still splits them).
export function resolveSiemIndex(env: Record<string, string | undefined>): string {
  const raw = env.OFFGRID_SIEM_INDEX ?? env.OFFGRID_OPENSEARCH_INDEX ?? DEFAULT_SIEM_INDEX;
  const seen = new Set<string>();
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter((p) => p && !seen.has(p) && (seen.add(p), true));
  return (list.length ? list : [DEFAULT_SIEM_INDEX]).map((p) => encodeURIComponent(p)).join(',');
}

// ── Thin best-effort reader (network I/O; zero imports so the file stays self-contained) ───────
// Queries the OpenSearch security/audit index(es) and hands raw hits to the pure normalizer above.
// Never throws: returns { data, error, configured } so the read-back page renders reachability
// without try/catch.
//   OFFGRID_OPENSEARCH_URL — e.g. http://127.0.0.1:9200 (defaults to localhost)
//   OFFGRID_SIEM_INDEX     — index/alias list the SIEM page reads (defaults to offgrid-audit; see resolveSiemIndex)
export interface SiemReadResult {
  configured: boolean;
  data: SiemView;
  error: string | null;
}

// Compose the SIEM query clause: match_all, or (when a pipeline tag is given) a bool that keeps only
// the audit events attributed to that pipeline. The tag (`pipeline:<id>`) lands in `project` OR
// `resource` on the audit docs, so we `should`-match either keyword field. Pure. Exported for tests.
export function siemQueryClause(pipelineTag?: string | null): Record<string, unknown> {
  if (!pipelineTag) return { match_all: {} };
  return {
    bool: {
      minimum_should_match: 1,
      should: [
        { term: { 'project.keyword': pipelineTag } },
        { term: { 'resource.keyword': pipelineTag } },
      ],
    },
  };
}

export async function readSiemView(
  limit = 500,
  pipelineTag?: string | null,
): Promise<SiemReadResult> {
  const empty = normalizeSiem(null);
  const configured = Boolean(process.env.OFFGRID_OPENSEARCH_URL);
  const url = process.env.OFFGRID_OPENSEARCH_URL ?? 'http://127.0.0.1:9200';
  const index = resolveSiemIndex(process.env);
  try {
    const r = await fetch(`${url}/${index}/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        size: limit,
        sort: [{ '@timestamp': { order: 'desc', unmapped_type: 'date' } }],
        query: siemQueryClause(pipelineTag),
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return { configured, data: empty, error: `OpenSearch ${r.status}` };
    const json = (await r.json()) as RawSiemResponse;
    return { configured, data: normalizeSiem(json), error: null };
  } catch (e) {
    return { configured, data: empty, error: (e as Error).message };
  }
}
