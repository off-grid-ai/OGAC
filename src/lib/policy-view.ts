// Policy decisions read-back — the PURE display model plus a thin adapter reader.
//
// The normalizer below is dependency-free (zero imports): given raw OPA decision-log records — the
// standard OPA decision-log JSON shape (github.com/open-policy-agent/opa decision logging) — or the
// policy adapter's own PolicyDecision output, it produces a stable, display-ready row. This is the
// SOLID seam: the shaping rule lives here (unit-testable, no network); the I/O (fetching health /
// active policies from the OPA adapter) is the thin reader at the bottom.

// ─── Pure display model ─────────────────────────────────────────────────────

export interface PolicyDecisionRow {
  id: string;
  decision: string; // human label, e.g. "allow" / "deny"
  allow: boolean;
  path: string; // the queried policy path (e.g. offgrid/authz)
  input: string; // one-line summary of the decision input
  timestamp: string; // ISO-8601, or '' when absent/unparseable
  engine: string; // which engine answered (opa / abac)
}

// The loose shape we accept. OPA decision logs, the console policy adapter's PolicyDecision, and
// hand-rolled records all overlap on these fields; every field is optional so malformed records
// degrade to safe defaults rather than throwing.
export interface RawPolicyRecord {
  decision_id?: string;
  id?: string;
  path?: string;
  query?: string;
  resource?: string;
  input?: unknown;
  result?: unknown;
  allow?: unknown;
  allowed?: unknown;
  decision?: unknown;
  reason?: unknown;
  engine?: unknown;
  timestamp?: unknown;
  time?: unknown;
}

// Truthiness for an allow/deny signal that may arrive as boolean, string, or nested { allow }.
function readAllow(rec: RawPolicyRecord): boolean {
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
  return false; // default deny — absent/unknown never reads as allow
}

// Summarize the decision input into one line. Objects → sorted key=value pairs; primitives → string.
function summarizeInput(input: unknown): string {
  if (input === undefined || input === null) return '—';
  if (typeof input !== 'object') return String(input);
  const obj = input as Record<string, unknown>;
  const parts = Object.keys(obj)
    .sort()
    .map((k) => {
      const val = obj[k];
      const s = val !== null && typeof val === 'object' ? JSON.stringify(val) : String(val);
      return `${k}=${s}`;
    });
  return parts.length ? parts.join(', ') : '—';
}

function normalizeTimestamp(rec: RawPolicyRecord): string {
  const raw = rec.timestamp ?? rec.time;
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** Normalize one raw record into a display row. Never throws on malformed input. */
export function normalizeDecision(rec: RawPolicyRecord, index = 0): PolicyDecisionRow {
  const allow = readAllow(rec);
  const path =
    (typeof rec.path === 'string' && rec.path) ||
    (typeof rec.query === 'string' && rec.query) ||
    (typeof rec.resource === 'string' && rec.resource) ||
    '';
  const id =
    (typeof rec.decision_id === 'string' && rec.decision_id) ||
    (typeof rec.id === 'string' && rec.id) ||
    `decision-${index}`;
  return {
    id,
    decision: allow ? 'allow' : 'deny',
    allow,
    path,
    input: summarizeInput(rec.input),
    timestamp: normalizeTimestamp(rec),
    engine: typeof rec.engine === 'string' && rec.engine ? rec.engine : 'opa',
  };
}

/** Normalize a batch of raw records; non-array / empty input yields an empty list. */
export function normalizeDecisions(raw: unknown): PolicyDecisionRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r, i) => normalizeDecision((r ?? {}) as RawPolicyRecord, i));
}

// ─── Thin reader (I/O) ──────────────────────────────────────────────────────

export interface ActivePolicyMeta {
  id: string;
  vendor: string;
  license: string;
  description: string;
}

export interface PolicyStatus {
  engine: string; // active policy adapter id (opa / abac)
  reachable: boolean; // OPA health probe, or true for the always-on first-party engine
  policies: ActivePolicyMeta[]; // the registered policy adapters (the active policy set)
}

// Read live policy status through the existing registry entries — no new wiring. `opa` is reachable
// only when its health probe passes; the first-party `abac` engine is always on.
export async function readPolicyStatus(): Promise<PolicyStatus> {
  const { getPolicy } = await import('@/lib/adapters/registry');
  const { POLICY } = await import('@/lib/adapters/services');
  const active = getPolicy();
  const entry = POLICY.find((e) => e.meta.id === active.meta.id);
  const reachable = entry?.health ? await entry.health() : true;
  return {
    engine: active.meta.id,
    reachable,
    policies: POLICY.map((e) => ({
      id: e.meta.id,
      vendor: e.meta.vendor,
      license: e.meta.license,
      description: e.meta.description,
    })),
  };
}

// Fetch OPA decision logs when the console-facing decision-log endpoint is configured, else []. The
// sink URL is separate from OFFGRID_OPA_URL (OPA ships decisions to an external sink, not its data
// API). Absent config or any error → empty list, so the surface degrades to "no decisions yet".
export async function readDecisions(): Promise<PolicyDecisionRow[]> {
  const sink = process.env.OFFGRID_OPA_DECISION_LOG_URL;
  if (!sink) return [];
  try {
    const res = await fetch(sink, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const body = await res.json();
    const raw = Array.isArray(body) ? body : (body?.data ?? body?.decisions ?? body?.result);
    return normalizeDecisions(raw);
  } catch {
    return [];
  }
}
