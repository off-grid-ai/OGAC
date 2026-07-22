// OPA audit backbone — PURE, zero-IO normalization + filtering for the compliance surface.
//
// Two families of OPA payloads are shaped here so the routes/UI never parse raw OPA JSON:
//   1. DECISION LOGS — OPA's decision-log plugin streams an array of decision events to a configured
//      HTTP sink (OFFGRID_OPA_DECISION_LOG_URL / the console ingest endpoint). Each event is the
//      standard OPA decision-log shape (decision_id, path, input, result, timestamp, labels,
//      requested_by, bundles). `normalizeDecisionEvent(s)` turns those into a stable, storable row.
//   2. CONFIG / BUNDLES / LOADED POLICIES — `GET /v1/config`, `GET /v1/status`, `GET /v1/policies`.
//      Normalized into an honest bundle/config summary (what is CONFIGURED vs. what is merely loaded).
//
// SOLID: this module has zero imports and does no I/O — every function is a pure transform of a
// loose input into a typed output, so it is exhaustively unit-testable. The network lives in
// adapters/opa-audit.ts and the DB in opa-decision-log-store.ts. Malformed input never throws:
// unknown/absent signals degrade to safe defaults (default-deny for allow, '' for timestamps).

// ─── Decision-log rows ────────────────────────────────────────────────────────

export interface OpaDecisionEvent {
  decisionId: string; // OPA decision_id (stable per decision), or a synthesized fallback
  path: string; // queried policy path / action (e.g. offgrid/authz)
  allow: boolean; // the allow/deny outcome (default deny when absent)
  reason: string; // human reason where present
  engine: string; // which engine answered (opa / abac)
  actor: string; // requesting principal, when the event carries one
  timestamp: string; // ISO-8601, or '' when absent/unparseable
  input: Record<string, unknown> | null; // full decision input (for the detail view)
  result: unknown; // full decision result (for the detail view)
  labels: Record<string, string>; // OPA node labels (id/version), when present
}

// The loose OPA decision-log event shape. Every field optional so partial records degrade safely.
export interface RawDecisionEvent {
  decision_id?: unknown;
  id?: unknown;
  path?: unknown;
  query?: unknown;
  input?: unknown;
  result?: unknown;
  allow?: unknown;
  allowed?: unknown;
  decision?: unknown;
  reason?: unknown;
  engine?: unknown;
  requested_by?: unknown;
  actor?: unknown;
  timestamp?: unknown;
  time?: unknown;
  labels?: unknown;
}

// Truthiness for an allow signal that may arrive as boolean, string, or nested { allow }/{ allowed }.
// Absent or unknown NEVER reads as allow (default-deny is the safe compliance default).
export function readAllow(rec: RawDecisionEvent): boolean {
  const candidates: unknown[] = [rec.allow, rec.allowed, rec.decision];
  const result = rec.result;
  if (result !== null && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    candidates.push(r.allow, r.allowed);
  } else {
    candidates.push(result);
  }
  for (const c of candidates) {
    if (typeof c === 'boolean') return c;
    if (typeof c === 'string') {
      const v = c.trim().toLowerCase();
      if (v === 'true' || v === 'allow' || v === 'allowed') return true;
      if (v === 'false' || v === 'deny' || v === 'denied') return false;
    }
  }
  return false;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function normalizeTimestamp(rec: RawDecisionEvent): string {
  const raw = rec.timestamp ?? rec.time;
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

// Coerce a labels-like value into a flat string map (OPA emits { id, version }). Non-objects → {}.
function normalizeLabels(v: unknown): Record<string, string> {
  if (v === null || typeof v !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      out[k] = String(val);
    }
  }
  return out;
}

function normalizeInput(v: unknown): Record<string, unknown> | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

/** Normalize one raw OPA decision-log event into a stable, storable row. Never throws. */
export function normalizeDecisionEvent(rec: RawDecisionEvent, index = 0): OpaDecisionEvent {
  const decisionId = str(rec.decision_id) || str(rec.id) || `decision-${index}`;
  const path = str(rec.path) || str(rec.query) || 'offgrid/authz';
  const engine = str(rec.engine) || 'opa';
  const actor = str(rec.requested_by) || str(rec.actor) || '';
  return {
    decisionId,
    path,
    allow: readAllow(rec),
    reason: str(rec.reason),
    engine,
    actor,
    timestamp: normalizeTimestamp(rec),
    input: normalizeInput(rec.input),
    result: rec.result ?? null,
    labels: normalizeLabels(rec.labels),
  };
}

// Accept the many shapes an OPA decision-log upload can take: a bare array, or an envelope with
// `data` / `decisions` / `result`. Anything else yields an empty list.
export function extractEventArray(raw: unknown): RawDecisionEvent[] {
  if (Array.isArray(raw)) return raw as RawDecisionEvent[];
  if (raw !== null && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const key of ['data', 'decisions', 'result']) {
      if (Array.isArray(o[key])) return o[key] as RawDecisionEvent[];
    }
  }
  return [];
}

/** Normalize a batch of raw events; non-array / empty input yields an empty list. */
export function normalizeDecisionEvents(raw: unknown): OpaDecisionEvent[] {
  return extractEventArray(raw).map((r, i) =>
    normalizeDecisionEvent((r ?? {}) as RawDecisionEvent, i),
  );
}

// ─── Query validation + filtering + aggregation (pure) ──────────────────────────

export type DecisionFilterKind = 'all' | 'allow' | 'deny';

export interface DecisionQuery {
  limit: number; // 1..MAX_QUERY_LIMIT
  decision: DecisionFilterKind;
  path: string; // case-insensitive substring; '' = no filter
  since: string; // ISO lower bound; '' = no bound
}

export const MAX_QUERY_LIMIT = 500;
const DEFAULT_QUERY_LIMIT = 100;

// Validate/normalize raw query params (strings off the URL) into a safe DecisionQuery.
export function validateDecisionQuery(params: {
  limit?: string | null;
  decision?: string | null;
  path?: string | null;
  since?: string | null;
}): DecisionQuery {
  const rawLimit = Number(params.limit);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_QUERY_LIMIT)
      : DEFAULT_QUERY_LIMIT;
  const d = (params.decision ?? '').trim().toLowerCase();
  const decision: DecisionFilterKind = d === 'allow' ? 'allow' : d === 'deny' ? 'deny' : 'all';
  const path = (params.path ?? '').trim();
  const sinceRaw = (params.since ?? '').trim();
  let since = '';
  if (sinceRaw) {
    const parsed = new Date(sinceRaw);
    if (!Number.isNaN(parsed.getTime())) since = parsed.toISOString();
  }
  return { limit, decision, path, since };
}

/** Apply a validated query to a list of events (newest-first order preserved). Pure. */
export function filterDecisions(
  events: readonly OpaDecisionEvent[],
  query: DecisionQuery,
): OpaDecisionEvent[] {
  const needle = query.path.toLowerCase();
  const out = events.filter((e) => {
    if (query.decision === 'allow' && !e.allow) return false;
    if (query.decision === 'deny' && e.allow) return false;
    if (needle && !e.path.toLowerCase().includes(needle)) return false;
    if (query.since && (e.timestamp === '' || e.timestamp < query.since)) return false;
    return true;
  });
  return out.slice(0, query.limit);
}

export interface DecisionAggregate {
  total: number;
  allow: number;
  deny: number;
  byEngine: Record<string, number>;
  byPath: Record<string, number>;
}

/** Aggregate counts over a set of decisions — the compliance summary band. Pure. */
export function aggregateDecisions(events: readonly OpaDecisionEvent[]): DecisionAggregate {
  const agg: DecisionAggregate = { total: 0, allow: 0, deny: 0, byEngine: {}, byPath: {} };
  for (const e of events) {
    agg.total += 1;
    if (e.allow) agg.allow += 1;
    else agg.deny += 1;
    agg.byEngine[e.engine] = (agg.byEngine[e.engine] ?? 0) + 1;
    agg.byPath[e.path] = (agg.byPath[e.path] ?? 0) + 1;
  }
  return agg;
}

// ─── Config / bundles / loaded policies (pure normalizers) ──────────────────────

export interface BundleConfigSummary {
  name: string; // bundle name from config
  service: string; // service the bundle is fetched from
  resource: string; // bundle resource path
  polling: boolean; // whether periodic polling is configured
}

export interface OpaConfigSummary {
  labels: Record<string, string>; // node id + OPA version
  defaultDecision: string; // config.default_decision
  defaultAuthzDecision: string; // config.default_authorization_decision
  decisionLogsConfigured: boolean; // is the decision-log plugin configured?
  decisionLogService: string; // where OPA ships decision logs, when configured
  bundles: BundleConfigSummary[]; // configured (remote) bundles — [] when policy is loaded via API
}

function normalizeBundleConfig(raw: unknown): BundleConfigSummary[] {
  if (raw === null || typeof raw !== 'object') return [];
  const out: BundleConfigSummary[] = [];
  for (const [name, val] of Object.entries(raw as Record<string, unknown>)) {
    const b = val !== null && typeof val === 'object' ? (val as Record<string, unknown>) : {};
    out.push({
      name,
      service: str(b.service),
      resource: str(b.resource),
      polling: b.polling !== null && typeof b.polling === 'object',
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Normalize `GET /v1/config` (the `result` object) into the honest config summary. When neither
// `bundles` nor `decision_logs` is present (the current on-prem deployment), the flags read false
// and `bundles` is [] — the surface then honestly reports "policy loaded via API, no remote bundle".
export function normalizeOpaConfig(raw: unknown): OpaConfigSummary {
  const result =
    raw !== null && typeof raw === 'object' && 'result' in (raw as Record<string, unknown>)
      ? (raw as Record<string, unknown>).result
      : raw;
  const cfg = (result !== null && typeof result === 'object' ? result : {}) as Record<
    string,
    unknown
  >;
  const dl = cfg.decision_logs;
  const dlObj = dl !== null && typeof dl === 'object' ? (dl as Record<string, unknown>) : null;
  return {
    labels: normalizeLabels(cfg.labels),
    defaultDecision: str(cfg.default_decision),
    defaultAuthzDecision: str(cfg.default_authorization_decision),
    decisionLogsConfigured: dlObj !== null,
    decisionLogService: dlObj ? str(dlObj.service) : '',
    bundles: normalizeBundleConfig(cfg.bundles),
  };
}

export interface BundleActivation {
  name: string;
  activeRevision: string;
  lastSuccessfulActivation: string; // ISO or ''
  lastRequest: string; // ISO or ''
  code: string; // error code, when the last activation failed
  message: string; // error message, when present
}

export interface BundleStatusSummary {
  statusPluginEnabled: boolean; // false when OPA replies "status plugin not enabled"
  activations: BundleActivation[];
}

function normalizeIsoField(v: unknown): string {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

// Normalize `GET /v1/status`. OPA reports per-bundle activation revisions here ONLY when the status
// plugin is enabled; otherwise it returns an internal_error whose message names the disabled plugin.
export function normalizeBundleStatus(raw: unknown): BundleStatusSummary {
  const obj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  // Disabled-plugin signal: { code: 'internal_error', message: '...status plugin not enabled' }.
  const code = str(obj.code);
  const message = str(obj.message);
  if (code === 'internal_error' && /status plugin/i.test(message)) {
    return { statusPluginEnabled: false, activations: [] };
  }
  const result =
    'result' in obj && obj.result !== null && typeof obj.result === 'object'
      ? (obj.result as Record<string, unknown>)
      : obj;
  const bundles = result.bundles;
  const activations: BundleActivation[] = [];
  if (bundles !== null && typeof bundles === 'object') {
    for (const [name, val] of Object.entries(bundles as Record<string, unknown>)) {
      const b = val !== null && typeof val === 'object' ? (val as Record<string, unknown>) : {};
      const hasErr = b.code !== undefined || b.message !== undefined;
      activations.push({
        name,
        activeRevision: str(b.active_revision),
        lastSuccessfulActivation: normalizeIsoField(b.last_successful_activation),
        lastRequest: normalizeIsoField(b.last_request),
        code: hasErr ? str(b.code) : '',
        message: hasErr ? str(b.message) : '',
      });
    }
  }
  return {
    statusPluginEnabled: true,
    activations: activations.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export interface LoadedPolicySummary {
  id: string; // OPA policy id (e.g. offgrid_authz)
  package: string; // the Rego package path (data.offgrid.authz → offgrid.authz)
  sourceBytes: number; // size of the raw Rego source
  ruleCount: number; // number of top-level rules (from the AST), when available
}

// Extract the package path from an OPA policy AST: ast.package.path is [{value:'data'},{value:'x'}..].
function packagePathFromAst(ast: unknown): string {
  if (ast === null || typeof ast !== 'object') return '';
  const pkg = (ast as Record<string, unknown>).package;
  if (pkg === null || typeof pkg !== 'object') return '';
  const path = (pkg as Record<string, unknown>).path;
  if (!Array.isArray(path)) return '';
  const parts = path
    .map((t) =>
      t !== null && typeof t === 'object' ? str((t as Record<string, unknown>).value) : '',
    )
    .filter((v) => v && v !== 'data');
  return parts.join('.');
}

function ruleCountFromAst(ast: unknown): number {
  if (ast === null || typeof ast !== 'object') return 0;
  const rules = (ast as Record<string, unknown>).rules;
  return Array.isArray(rules) ? rules.length : 0;
}

// Normalize `GET /v1/policies` — the policy modules OPA currently has loaded. On a deployment that
// loads policy via the policy API (no remote bundle) THIS is the honest "active policy set": what
// Rego is actually loaded, by id + package. Never throws on partial/absent AST.
export function normalizeLoadedPolicies(raw: unknown): LoadedPolicySummary[] {
  const result =
    raw !== null && typeof raw === 'object' && 'result' in (raw as Record<string, unknown>)
      ? (raw as Record<string, unknown>).result
      : raw;
  if (!Array.isArray(result)) return [];
  return result
    .map((p): LoadedPolicySummary => {
      const o = (p !== null && typeof p === 'object' ? p : {}) as Record<string, unknown>;
      return {
        id: str(o.id),
        package: packagePathFromAst(o.ast),
        sourceBytes: typeof o.raw === 'string' ? o.raw.length : 0,
        ruleCount: ruleCountFromAst(o.ast),
      };
    })
    .filter((p) => p.id !== '')
    .sort((a, b) => a.id.localeCompare(b.id));
}
