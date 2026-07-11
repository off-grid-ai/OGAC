// PURE audit-log display-model normalizer + filter contract — zero I/O, fully unit-testable. Its
// only import is another PURE same-layer helper (demo-test-artifacts) so the one rule for "is this
// the QA autotest actor?" lives in exactly one place (DRY) rather than being re-spelled here. This is the accountability surface's view-model: it turns the loosely-shaped
// `offgrid-audit` OpenSearch docs (read back through `searchAudit` in src/lib/siem.ts) into one
// clean row model answering "who did what, to what, on which project, with what model/tokens/cost,
// and how it turned out."
//
// TWO doc shapes land in `offgrid-audit` and BOTH must normalize:
//   1. The historical device/gateway `Shippable`  — flat: { id, deviceId, model, outcome,
//      tokens: number, keyId, runId, ts }.
//   2. The canonical Phase-4.11 audit event        — { ts, actor:{type,id,label}, org, project?,
//      action, resource?, model?, tokens:{prompt,completion,total}, costUsd?, outcome, runId?, ip? }.
// The normalizer reads either defensively (first-non-empty across candidate keys) so a mixed index
// renders coherently and no producer's rows go blank.
import { isAutotestActor } from '@/lib/demo-test-artifacts';
//
// The network read + the server-side filter push-down live in `searchAudit` (owned by the
// foundation agent). This file NEVER fetches. It also carries the FILTER + EXPORT contract so the
// page, the API route, and the export route all agree on one parse/serialize surface.

// ── Raw hit shapes (only fields we read; all optional/defensive) ────────────────────────────────
export interface RawAuditActor {
  type?: string;
  id?: string;
  label?: string;
}

export interface RawAuditTokens {
  prompt?: number;
  completion?: number;
  total?: number;
}

// A single hit. `searchAudit` (src/lib/siem.ts) FLATTENS OpenSearch hits into the doc's fields plus
// `id`/`score` — so a hit is the source record itself, not an `_source`-wrapped envelope. We also
// tolerate an `_source` wrapper defensively in case a caller passes raw OpenSearch hits.
export interface RawAuditHit {
  id?: string;
  _id?: string;
  score?: number | null;
  // canonical audit-event fields
  actor?: RawAuditActor | string;
  org?: string;
  project?: string;
  action?: string;
  resource?: string;
  model?: string;
  tokens?: RawAuditTokens | number;
  costUsd?: number;
  outcome?: string;
  runId?: string | null;
  ip?: string;
  ts?: string | number;
  // legacy device/gateway Shippable fields
  deviceId?: string;
  keyId?: string | null;
  leftDevice?: boolean;
  _source?: RawAuditHit;
}

// A source record — the flattened hit (or the unwrapped `_source`). Alias kept for the readers below.
export type RawAuditSource = RawAuditHit;

// The result envelope returned by searchAudit (src/lib/siem.ts). Mirrors AuditSearchResult so the
// normalizer can consume it without importing the (I/O-bearing) module.
export interface AuditSearchLike {
  total?: number;
  hits?: RawAuditHit[];
  configured?: boolean;
  error?: string;
}

// ── Display model ───────────────────────────────────────────────────────────────────────────────
export type AuditOutcome = 'ok' | 'blocked' | 'redacted' | 'denied' | 'error' | 'unknown';
export type ActorType = 'user' | 'machine' | 'unknown';

export interface AuditRow {
  id: string;
  ts: string; // ISO-8601, or '' when absent/unparseable
  actorType: ActorType;
  actor: string; // label || id, human-readable
  action: string;
  project: string;
  resource: string;
  model: string;
  tokens: number; // total tokens (sum of prompt+completion when only the split is present)
  costUsd: number;
  outcome: AuditOutcome;
  runId: string;
  ip: string;
}

export interface AuditView {
  total: number; // total matching docs in the index (server-reported, for pagination)
  rows: AuditRow[]; // this page of rows, newest-first
  configured: boolean;
  error?: string;
}

// ── Filter contract (URL ⇄ searchAudit params) ─────────────────────────────────────────────────
// The exact filter set the audit-log surface drives from the URL. `searchAudit` is being extended
// (by the foundation agent) to accept { actor, action, project, outcome, from, to } plus `q`.
export interface AuditFilters {
  q?: string; // free text
  actor?: string; // exact actor id/label
  action?: string; // exact action type
  project?: string; // exact project
  outcome?: string; // exact outcome
  from?: string; // ISO / date-time lower bound (inclusive)
  to?: string; // ISO / date-time upper bound (inclusive)
  page?: number; // 1-based
  size?: number; // page size
  /** Drop QA autotest-actor rows (set on customer-facing demo tenants — see demo-test-artifacts). */
  hideAutotest?: boolean;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;

// ── Helpers (pure) ──────────────────────────────────────────────────────────────────────────────
function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pick(s: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = str(s[k]);
    if (v) return v;
  }
  return '';
}

// Normalize a producer's outcome word into the canonical closed set from the roadmap contract
// (ok | blocked | redacted | error) plus denied (access events) and unknown.
export function classifyAuditOutcome(raw: string): AuditOutcome {
  const v = raw.toLowerCase().trim();
  if (['ok', 'allow', 'allowed', 'success', 'succeeded', 'permit', 'permitted'].includes(v))
    return 'ok';
  if (['redact', 'redacted', 'masked'].includes(v)) return 'redacted';
  if (['block', 'blocked', 'quarantined'].includes(v)) return 'blocked';
  if (['deny', 'denied', 'reject', 'rejected', 'forbidden', 'unauthorized'].includes(v))
    return 'denied';
  if (['error', 'failed', 'failure', 'exception'].includes(v)) return 'error';
  return 'unknown';
}

function normalizeActorType(v: string): ActorType {
  const t = v.toLowerCase();
  if (t === 'user' || t === 'human' || t === 'person') return 'user';
  if (t === 'machine' || t === 'service' || t === 'client' || t === 'agent') return 'machine';
  return 'unknown';
}

function normalizeTs(s: RawAuditSource): string {
  const raw = pick(s as Record<string, unknown>, ['ts', '@timestamp', 'timestamp', 'time']);
  if (!raw) {
    const epoch = num(s.ts);
    if (epoch > 0) {
      const d = new Date(epoch < 1e12 ? epoch * 1000 : epoch);
      return Number.isNaN(d.getTime()) ? '' : d.toISOString();
    }
    return '';
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

// Resolve tokens from either the canonical { prompt, completion, total } object or a flat number.
function normalizeTokens(t: RawAuditTokens | number | undefined): number {
  if (typeof t === 'number') return Number.isFinite(t) ? t : 0;
  if (t && typeof t === 'object') {
    if (typeof t.total === 'number' && Number.isFinite(t.total)) return t.total;
    return num(t.prompt) + num(t.completion);
  }
  return 0;
}

// Resolve the actor from either the canonical actor object OR the legacy deviceId/keyId flat fields.
function normalizeActor(s: RawAuditSource): { actorType: ActorType; actor: string } {
  const a = s.actor;
  if (a && typeof a === 'object') {
    const label = str(a.label) || str(a.id);
    return { actorType: normalizeActorType(str(a.type)), actor: label || 'unknown' };
  }
  const flat = str(a);
  if (flat) return { actorType: 'unknown', actor: flat };
  // Legacy: a device/gateway doc. deviceId identifies the machine; keyId is the caller.
  const device = str(s.deviceId);
  const key = str(s.keyId);
  if (device.startsWith('agent:')) return { actorType: 'machine', actor: key || device };
  if (device) return { actorType: 'machine', actor: device };
  if (key) return { actorType: 'machine', actor: key };
  return { actorType: 'unknown', actor: 'unknown' };
}

function toRow(hit: RawAuditHit, index: number): AuditRow {
  const s: RawAuditSource = hit._source ?? hit;
  const { actorType, actor } = normalizeActor(s);
  return {
    id: str(hit.id) || str(hit._id) || str(s.runId) || `audit-${index}`,
    ts: normalizeTs(s),
    actorType,
    actor,
    action:
      pick(s as Record<string, unknown>, ['action', 'event', 'eventType', 'operation']) ||
      'unknown',
    project: pick(s as Record<string, unknown>, ['project', 'org']),
    resource: pick(s as Record<string, unknown>, ['resource', 'target', 'deviceId']),
    model: pick(s as Record<string, unknown>, ['model']),
    tokens: normalizeTokens(s.tokens),
    costUsd: num(s.costUsd),
    outcome: classifyAuditOutcome(
      pick(s as Record<string, unknown>, ['outcome', 'result', 'verdict', 'status']),
    ),
    runId: pick(s as Record<string, unknown>, ['runId']),
    ip: pick(s as Record<string, unknown>, ['ip', 'sourceIp', 'clientIp']),
  };
}

// ── The pure normalizer: searchAudit result (or bare hits, or null) → display view ─────────────
export function normalizeAudit(
  input: AuditSearchLike | RawAuditHit[] | null | undefined,
): AuditView {
  const hits: RawAuditHit[] = Array.isArray(input) ? input : (input?.hits ?? []);
  const rows = hits.map((h, i) => toRow(h, i));
  // Newest-first; rows without a timestamp sort to the end. (The server already sorts desc; this
  // keeps the guarantee even when a producer omitted ts.)
  rows.sort((a, b) => {
    if (a.ts && b.ts) return b.ts.localeCompare(a.ts);
    if (a.ts) return -1;
    if (b.ts) return 1;
    return 0;
  });
  const configured = Array.isArray(input) ? true : (input?.configured ?? false);
  const total = Array.isArray(input) ? rows.length : (input?.total ?? rows.length);
  const error = Array.isArray(input) ? undefined : input?.error;
  return { total, rows, configured, error };
}

// ── Pure post-filter (graceful degradation) ────────────────────────────────────────────────────
// `searchAudit` (foundation agent) is being extended to push actor/action/project/outcome/time-range
// filters into OpenSearch. Until every filter is wired server-side, we apply them here over the
// normalized rows so the surface is correct TODAY. When the server narrows natively this is a
// harmless no-op over an already-narrowed set — never a double-filter bug (it's idempotent: filtering
// an already-matching set changes nothing).
//
// Exact-match on actor/action/project/outcome (case-insensitive); inclusive time-range on ts. `q`
// is intentionally NOT applied here — full-text relevance is the server's job (`multi_match`); a
// naive substring re-filter would drop fuzzy/relevance hits the server correctly returned.
export function filterAuditRows(rows: AuditRow[], f: AuditFilters): AuditRow[] {
  const eq = (a: string, b?: string) => !b || a.toLowerCase() === b.toLowerCase();
  const fromMs = f.from ? Date.parse(f.from) : Number.NaN;
  const toMs = f.to ? Date.parse(f.to) : Number.NaN;
  return rows.filter((r) => {
    if (f.hideAutotest && isAutotestActor(r.actor)) return false;
    if (!eq(r.actor, f.actor)) return false;
    if (!eq(r.action, f.action)) return false;
    if (!eq(r.project, f.project)) return false;
    if (!eq(r.outcome, f.outcome)) return false;
    if (Number.isFinite(fromMs) || Number.isFinite(toMs)) {
      const t = r.ts ? Date.parse(r.ts) : Number.NaN;
      if (!Number.isFinite(t)) return false;
      if (Number.isFinite(fromMs) && t < fromMs) return false;
      if (Number.isFinite(toMs) && t > toMs) return false;
    }
    return true;
  });
}

// Distinct sorted facet values from a row set — powers the filter dropdowns (actor/action/project)
// without a second round-trip. Pure.
export function auditFacets(rows: AuditRow[]): {
  actors: string[];
  actions: string[];
  projects: string[];
  outcomes: AuditOutcome[];
} {
  const uniq = (vals: string[]) =>
    [...new Set(vals.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    actors: uniq(rows.map((r) => r.actor)),
    actions: uniq(rows.map((r) => r.action)),
    projects: uniq(rows.map((r) => r.project)),
    outcomes: uniq(rows.map((r) => r.outcome)) as AuditOutcome[],
  };
}

// ── Filter parse/serialize (URL ⇄ AuditFilters) — pure, shared by page + export route ──────────
// Parse a URLSearchParams-like getter into the filter contract. Blank/whitespace values drop out so
// an empty filter box never becomes a `field=""` term query.
export function parseAuditFilters(get: (k: string) => string | null): AuditFilters {
  const clean = (k: string): string | undefined => {
    const v = get(k)?.trim();
    return v ? v : undefined;
  };
  const pageRaw = Number(get('page'));
  const sizeRaw = Number(get('size'));
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const size =
    Number.isFinite(sizeRaw) && sizeRaw > 0
      ? Math.min(Math.floor(sizeRaw), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  return {
    q: clean('q'),
    actor: clean('actor'),
    action: clean('action'),
    project: clean('project'),
    outcome: clean('outcome'),
    from: clean('from'),
    to: clean('to'),
    page,
    size,
  };
}

// Map the filter contract to the concrete `searchAudit` params (offset pagination). Kept here so the
// page and the export route derive identical queries from identical filters.
export function auditFiltersToSearchParams(f: AuditFilters): {
  q?: string;
  actor?: string;
  action?: string;
  project?: string;
  outcome?: string;
  from?: string;
  to?: string;
  size: number;
  from_offset: number;
} {
  const size = f.size ?? DEFAULT_PAGE_SIZE;
  const page = f.page && f.page >= 1 ? f.page : 1;
  return {
    q: f.q,
    actor: f.actor,
    action: f.action,
    project: f.project,
    outcome: f.outcome,
    from: f.from,
    to: f.to,
    size,
    from_offset: (page - 1) * size,
  };
}

// Serialize filters back to a query string (for pagination links / export href). Omits pagination
// keys when asked (export takes the whole filtered set, not one page).
export function auditFiltersToQuery(
  f: AuditFilters,
  opts: { includePaging?: boolean } = {},
): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.actor) p.set('actor', f.actor);
  if (f.action) p.set('action', f.action);
  if (f.project) p.set('project', f.project);
  if (f.outcome) p.set('outcome', f.outcome);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (opts.includePaging) {
    if (f.page && f.page !== 1) p.set('page', String(f.page));
    if (f.size && f.size !== DEFAULT_PAGE_SIZE) p.set('size', String(f.size));
  }
  return p.toString();
}

// ── CSV / JSON export serializers — pure, so the export route stays a thin I/O shell ───────────
const CSV_COLUMNS: { key: keyof AuditRow; header: string }[] = [
  { key: 'ts', header: 'time' },
  { key: 'actorType', header: 'actor_type' },
  { key: 'actor', header: 'actor' },
  { key: 'action', header: 'action' },
  { key: 'project', header: 'project' },
  { key: 'resource', header: 'resource' },
  { key: 'model', header: 'model' },
  { key: 'tokens', header: 'tokens' },
  { key: 'costUsd', header: 'cost_usd' },
  { key: 'outcome', header: 'outcome' },
  { key: 'runId', header: 'run_id' },
  { key: 'ip', header: 'ip' },
];

function csvCell(v: string | number): string {
  const s = String(v ?? '');
  // Quote if the value contains a comma, quote, CR, LF — and escape embedded quotes.
  if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function auditRowsToCsv(rows: AuditRow[]): string {
  const head = CSV_COLUMNS.map((c) => c.header).join(',');
  const lines = rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c.key])).join(','));
  return [head, ...lines].join('\r\n') + '\r\n';
}

export function auditRowsToJson(rows: AuditRow[]): string {
  return JSON.stringify(rows, null, 2);
}
