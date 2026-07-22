// Pure, ZERO-IO query logic for the centralized log-search + retention surface over VictoriaLogs.
// Everything here is a deterministic transform — no network, no env — so it's fully unit-testable
// (test/victorialogs-query.test.ts). The thin I/O half lives in src/lib/adapters/victorialogs.ts.
//
// DRY: the JSONL log-line parsing + result row model already exist in victoria-logs-shape.ts (used
// by the platform-health Logs tab) — we REUSE them here rather than re-implement, and add the NEW
// pieces this surface needs: a safe LogsQL builder (free text + field filters), time-range → VL
// start/end parsing, hits → histogram-series shaping, and field-value/field-name normalization.

export type { LogRow } from './victoria-logs-shape';
export { parseLogsResponse, parseLogLine } from './victoria-logs-shape';

// ─── Time ranges ───────────────────────────────────────────────────────────
// The range keys the UI offers. Each maps to a VictoriaLogs-relative start offset (VL accepts
// relative durations like `-15m` against `now`) and a bucket `step` sized so the histogram has a
// sensible number of bars for that window.
export interface TimeRange {
  key: string;
  label: string;
  start: string; // VL `start=` value, relative to now
  step: string; // VL `step=` bucket width for /hits
}

export const TIME_RANGES: readonly TimeRange[] = [
  { key: '15m', label: 'Last 15 minutes', start: '-15m', step: '30s' },
  { key: '1h', label: 'Last 1 hour', start: '-1h', step: '2m' },
  { key: '24h', label: 'Last 24 hours', start: '-24h', step: '30m' },
  { key: '7d', label: 'Last 7 days', start: '-7d', step: '3h' },
] as const;

export const DEFAULT_RANGE_KEY = '1h';

// Resolve a (possibly untrusted) range key to a known TimeRange, defaulting to 1h. Never throws.
export function parseRange(raw: string | null | undefined): TimeRange {
  const key = (raw ?? '').trim();
  return (
    TIME_RANGES.find((r) => r.key === key) ??
    TIME_RANGES.find((r) => r.key === DEFAULT_RANGE_KEY)!
  );
}

// ─── Result limit ────────────────────────────────────────────────────────────
export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 1000;

// Clamp a requested row limit into [1, MAX_LIMIT]; non-numeric / missing → DEFAULT_LIMIT.
export function clampLimit(raw: string | number | null | undefined): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
}

// ─── LogsQL builder ───────────────────────────────────────────────────────────
// A field filter selected from a dropdown (e.g. {field:'level', value:'error'}). Composed into a
// LogsQL `field:"value"` phrase. We treat service/level as regular ingested log fields — the common
// shape when logs are shipped with those fields — not stream labels.
export interface LogFilter {
  field: string;
  value: string;
}

// Escape a value for a LogsQL double-quoted phrase: backslash first, then the quote char. This keeps
// operator-supplied filter values from breaking out of the phrase (no query injection).
export function escapeLogsQLValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// A single `field:"value"` phrase, or '' if either side is blank (so it drops out of the AND-join).
export function fieldFilterClause(filter: LogFilter): string {
  const field = filter.field?.trim() ?? '';
  const value = filter.value?.trim() ?? '';
  if (!field || !value) return '';
  return `${field}:"${escapeLogsQLValue(value)}"`;
}

export interface QueryParts {
  text?: string; // free-text LogsQL the operator typed
  filters?: LogFilter[]; // dropdown-selected field filters
}

// Compose free text + field filters into one LogsQL string. Filters and free text AND together
// (space-joined, LogsQL's implicit AND). An empty composition means "everything" → `*`, so the
// search box works with no input. Pure + never throws.
export function buildLogsQuery(parts: QueryParts): string {
  const clauses: string[] = [];
  for (const f of parts.filters ?? []) {
    const clause = fieldFilterClause(f);
    if (clause) clauses.push(clause);
  }
  const text = (parts.text ?? '').trim();
  if (text) clauses.push(text);
  const joined = clauses.join(' ').trim();
  return joined || '*';
}

// ─── Hits → histogram series ────────────────────────────────────────────────
export interface HistogramBucket {
  time: string; // ISO timestamp of the bucket start
  count: number;
}
export interface HistogramSeries {
  buckets: HistogramBucket[];
  total: number;
  max: number; // largest bucket count — for bar scaling in the UI
}

// VictoriaLogs `/select/logsql/hits` returns
//   { "hits": [ { "fields": {...}, "timestamps": ["<iso>", ...], "values": [n, ...], "total": N } ] }
// We SUM the per-series values at each timestamp into one combined histogram (the surface shows total
// volume, optionally already filtered by the query). Tolerant of missing/short arrays; never throws.
export function shapeHits(raw: unknown): HistogramSeries {
  const empty: HistogramSeries = { buckets: [], total: 0, max: 0 };
  if (!raw || typeof raw !== 'object') return empty;
  const hits = (raw as { hits?: unknown }).hits;
  if (!Array.isArray(hits) || hits.length === 0) return empty;

  const sums = new Map<string, number>();
  const order: string[] = [];
  for (const series of hits) {
    if (!series || typeof series !== 'object') continue;
    const timestamps = (series as { timestamps?: unknown }).timestamps;
    const values = (series as { values?: unknown }).values;
    if (!Array.isArray(timestamps) || !Array.isArray(values)) continue;
    for (let i = 0; i < timestamps.length; i++) {
      const ts = String(timestamps[i]);
      const v = Number(values[i]);
      const add = Number.isFinite(v) ? v : 0;
      if (!sums.has(ts)) order.push(ts);
      sums.set(ts, (sums.get(ts) ?? 0) + add);
    }
  }
  if (order.length === 0) return empty;

  order.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const buckets = order.map((time) => ({ time, count: sums.get(time) ?? 0 }));
  const total = buckets.reduce((acc, b) => acc + b.count, 0);
  const max = buckets.reduce((acc, b) => (b.count > acc ? b.count : acc), 0);
  return { buckets, total, max };
}

// ─── Field values / names ─────────────────────────────────────────────────────
export interface FieldValue {
  value: string;
  hits: number;
}

// VictoriaLogs `/select/logsql/field_values` and `/field_names` both return
//   { "values": [ { "value": "info", "hits": 1234 }, ... ] }
// (older builds return a bare string array). Normalize both shapes to typed rows, drop blanks,
// sort by hits desc then value asc for a stable dropdown. Pure; never throws.
export function normalizeFieldValues(raw: unknown): FieldValue[] {
  if (!raw || typeof raw !== 'object') return [];
  const values = (raw as { values?: unknown }).values;
  if (!Array.isArray(values)) return [];
  const out: FieldValue[] = [];
  for (const entry of values) {
    if (typeof entry === 'string') {
      const value = entry.trim();
      if (value) out.push({ value, hits: 0 });
      continue;
    }
    if (entry && typeof entry === 'object') {
      const value = String((entry as { value?: unknown }).value ?? '').trim();
      if (!value) continue;
      const hitsNum = Number((entry as { hits?: unknown }).hits);
      out.push({ value, hits: Number.isFinite(hitsNum) ? hitsNum : 0 });
    }
  }
  out.sort(
    (a, b) => b.hits - a.hits || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0),
  );
  return out;
}

// ─── Retention parsing ─────────────────────────────────────────────────────────
export interface RetentionInfo {
  // The configured retention period if VictoriaLogs surfaced a non-default -retentionPeriod flag;
  // null when it's running the built-in default (VL doesn't report the effective default via /flags).
  retentionPeriod: string | null;
  source: 'flags' | 'default';
  note: string;
}

// VictoriaLogs `/flags` returns the command-line flags that were set to NON-default values, one per
// line, e.g. `-retentionPeriod="30d"` or `-retentionPeriod=90d`. Parse the retentionPeriod out of
// that text if present; otherwise report honestly that retention is the deploy-managed default (a
// single-node VL retention is a deploy flag, not a runtime-CRUD-able setting). Pure; never throws.
export function parseRetentionFlags(flagsText: string | null | undefined): RetentionInfo {
  const text = flagsText ?? '';
  const m = text.match(/-retentionPeriod\s*=\s*"?([^"\s]+)"?/);
  if (m && m[1]) {
    return {
      retentionPeriod: m[1],
      source: 'flags',
      note: 'Configured at deploy via VictoriaLogs -retentionPeriod. Change it in the deploy flag, not at runtime.',
    };
  }
  return {
    retentionPeriod: null,
    source: 'default',
    note: 'Running the VictoriaLogs default retention (no -retentionPeriod override). Retention on single-node VictoriaLogs is a deploy flag, not a runtime setting.',
  };
}
