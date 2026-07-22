// Pure, ZERO-IO query + response logic for the VictoriaMetrics metric-explorer + alerts surface.
// Everything here is a deterministic function of its inputs — no network, no clock except an
// injectable `now` — so it is fully unit-tested in test/victoriametrics-query.test.ts. The thin
// HTTP half lives in src/lib/adapters/victoriametrics.ts (excluded from coverage).
//
// This module OWNS:
//   • range-window → {start,end,step} arithmetic for range charts,
//   • URL query-string building for the Prometheus-compatible /api/v1/query{,_range} endpoints,
//   • normalization of /api/v1/rules (recording + alerting) and /api/v1/alerts (firing) responses,
//   • validation of a console-owned SAVED QUERY (the CRUD entity).
//
// Response-body SHAPING into recharts series is DELIBERATELY reused from victoria-metrics-shape.ts
// (shapeChart/shapeSeries/scalarValue) — one shaping rule, not two — so this file does not restate
// it. It re-exports the pieces the explorer needs from a single import site.

export {
  type ChartData,
  type MetricPoint,
  type MetricSeries,
  type PromQueryResponse,
  parseSampleValue,
  scalarValue,
  seriesLabel,
  shapeChart,
  shapeSeries,
} from './victoria-metrics-shape';

// ─── Range windows ─────────────────────────────────────────────────────────────
// The windows the explorer offers. Each maps to a span (seconds) and a resolution (step seconds)
// chosen so a range chart lands at a readable ~60–240 points — never so fine it floods the chart or
// so coarse it hides spikes.
export const RANGE_WINDOWS = ['15m', '1h', '6h', '24h', '7d'] as const;
export type RangeWindow = (typeof RANGE_WINDOWS)[number];

const RANGE_SPEC: Record<RangeWindow, { seconds: number; step: number }> = {
  '15m': { seconds: 15 * 60, step: 15 },
  '1h': { seconds: 60 * 60, step: 60 },
  '6h': { seconds: 6 * 60 * 60, step: 300 },
  '24h': { seconds: 24 * 60 * 60, step: 900 },
  '7d': { seconds: 7 * 24 * 60 * 60, step: 3600 },
};

export const DEFAULT_RANGE: RangeWindow = '1h';

// Coerce an arbitrary `?range=` value to a known window, falling back to the default. Trims and is
// case-sensitive to the canonical tokens (they are lowercase everywhere).
export function normalizeRange(raw: unknown): RangeWindow {
  const v = typeof raw === 'string' ? raw.trim() : '';
  return (RANGE_WINDOWS as readonly string[]).includes(v) ? (v as RangeWindow) : DEFAULT_RANGE;
}

export interface RangeParams {
  start: number; // unix seconds (inclusive)
  end: number; // unix seconds (inclusive)
  step: number; // seconds between points
}

// Compute the {start,end,step} for a window ending at `now` (injectable for deterministic tests).
export function rangeToParams(window: RangeWindow, now: Date = new Date()): RangeParams {
  const spec = RANGE_SPEC[window] ?? RANGE_SPEC[DEFAULT_RANGE];
  const end = Math.floor(now.getTime() / 1000);
  return { start: end - spec.seconds, end, step: spec.step };
}

// ─── Query-string builders ────────────────────────────────────────────────────
// Build the query string for an INSTANT query. `time` (unix seconds) is optional — VM defaults to
// "now" when omitted. The PromQL is URL-encoded exactly once here.
export function buildInstantQueryString(query: string, time?: number): string {
  const params = new URLSearchParams({ query });
  if (typeof time === 'number' && Number.isFinite(time)) params.set('time', String(Math.floor(time)));
  return `/api/v1/query?${params.toString()}`;
}

// Build the query string for a RANGE query from pre-computed {start,end,step}.
export function buildRangeQueryString(query: string, range: RangeParams): string {
  const params = new URLSearchParams({
    query,
    start: String(range.start),
    end: String(range.end),
    step: String(range.step),
  });
  return `/api/v1/query_range?${params.toString()}`;
}

// ─── Saved-query validation (the console-owned CRUD entity) ─────────────────────
export interface SavedQueryInput {
  name: string;
  query: string; // PromQL / MetricsQL
  range: RangeWindow;
  description: string;
}

const MAX_NAME = 120;
const MAX_QUERY = 4000;
const MAX_DESC = 500;

// A minimal, non-executing sanity check on a PromQL string: non-empty, within length, and balanced
// parentheses/brackets/braces. This is NOT a PromQL parser — VM is the authority on validity — it
// only rejects the obvious garbage (unterminated selectors) so a saved query can't be un-runnable in
// a way we could have caught cheaply. Returns null when fine, else a reason string.
export function promQLShapeError(query: string): string | null {
  const q = query.trim();
  if (!q) return 'query is required';
  if (q.length > MAX_QUERY) return `query must be ${MAX_QUERY} characters or fewer`;
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const opens = new Set(['(', '[', '{']);
  const stack: string[] = [];
  for (const ch of q) {
    if (opens.has(ch)) stack.push(ch);
    else if (ch in pairs) {
      if (stack.pop() !== pairs[ch]) return 'unbalanced brackets in query';
    }
  }
  if (stack.length > 0) return 'unbalanced brackets in query';
  return null;
}

export interface SavedQueryValidation {
  valid: boolean;
  errors: string[];
  value?: SavedQueryInput;
}

// Validate + normalize a raw saved-query payload into a clean SavedQueryInput. Trims strings, coerces
// range to a known window, and surfaces every problem at once (so the form can show them together).
export function validateSavedQuery(raw: unknown): SavedQueryValidation {
  const errors: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;

  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) errors.push('name is required');
  else if (name.length > MAX_NAME) errors.push(`name must be ${MAX_NAME} characters or fewer`);

  const query = typeof r.query === 'string' ? r.query.trim() : '';
  const qErr = promQLShapeError(query);
  if (qErr) errors.push(qErr);

  const description = typeof r.description === 'string' ? r.description.trim() : '';
  if (description.length > MAX_DESC) errors.push(`description must be ${MAX_DESC} characters or fewer`);

  const range = normalizeRange(r.range);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [], value: { name, query, range, description } };
}

// ─── Rules + alerts normalization (/api/v1/rules, /api/v1/alerts) ───────────────
// Prometheus-compatible shapes. VM only serves these when a rule engine (vmalert) is deployed and
// pointed at it; otherwise the endpoints are absent (the adapter reports engineDeployed:false and we
// never fabricate rules). These normalizers tolerate missing/partial fields and never throw.
export interface RawRule {
  name?: string;
  query?: string;
  type?: string; // 'recording' | 'alerting'
  state?: string; // alerting only: 'firing' | 'pending' | 'inactive'
  health?: string; // 'ok' | 'err' | 'unknown'
  duration?: number;
  labels?: Record<string, string> | null;
  annotations?: Record<string, string> | null;
  lastError?: string;
  alerts?: RawAlert[] | null;
}
export interface RawRuleGroup {
  name?: string;
  file?: string;
  rules?: RawRule[] | null;
}
export interface RawRulesResponse {
  status?: string;
  data?: { groups?: RawRuleGroup[] | null } | null;
  error?: string | null;
}
export interface RawAlert {
  labels?: Record<string, string> | null;
  annotations?: Record<string, string> | null;
  state?: string; // 'firing' | 'pending'
  activeAt?: string;
  value?: string;
}
export interface RawAlertsResponse {
  status?: string;
  data?: { alerts?: RawAlert[] | null } | null;
  error?: string | null;
}

export interface RuleView {
  name: string;
  group: string;
  type: 'recording' | 'alerting' | 'unknown';
  query: string;
  state: string; // '' for recording rules
  health: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  activeAlerts: number; // count of alerts currently attached to an alerting rule
}

function ruleType(t: string | undefined): RuleView['type'] {
  if (t === 'recording' || t === 'alerting') return t;
  return 'unknown';
}

// Flatten every group's rules into one ordered list, tagging each with its group name. Never throws.
export function normalizeRules(res: RawRulesResponse | null | undefined): RuleView[] {
  const groups = res?.data?.groups ?? [];
  if (!Array.isArray(groups)) return [];
  const out: RuleView[] = [];
  for (const g of groups) {
    const groupName = g?.name ?? g?.file ?? '';
    const rules = Array.isArray(g?.rules) ? g.rules : [];
    for (const rule of rules) {
      out.push({
        name: rule?.name ?? '',
        group: groupName,
        type: ruleType(rule?.type),
        query: rule?.query ?? '',
        state: rule?.state ?? '',
        health: rule?.health ?? 'unknown',
        labels: rule?.labels ?? {},
        annotations: rule?.annotations ?? {},
        activeAlerts: Array.isArray(rule?.alerts) ? rule.alerts.length : 0,
      });
    }
  }
  return out;
}

export interface AlertView {
  name: string; // from labels.alertname, else 'alert'
  state: string; // 'firing' | 'pending'
  labels: Record<string, string>;
  annotations: Record<string, string>;
  activeAt: string;
  value: string;
}

// Normalize the currently-active alerts. `name` prefers the conventional `alertname` label.
export function normalizeAlerts(res: RawAlertsResponse | null | undefined): AlertView[] {
  const alerts = res?.data?.alerts ?? [];
  if (!Array.isArray(alerts)) return [];
  return alerts.map((a) => {
    const labels = a?.labels ?? {};
    return {
      name: labels.alertname ?? 'alert',
      state: a?.state ?? '',
      labels,
      annotations: a?.annotations ?? {},
      activeAt: a?.activeAt ?? '',
      value: a?.value ?? '',
    };
  });
}

export interface AlertsSummary {
  firing: number;
  pending: number;
  total: number;
}

// A tiny roll-up for the header band: how many alerts are firing vs pending.
export function summarizeAlerts(alerts: AlertView[]): AlertsSummary {
  let firing = 0;
  let pending = 0;
  for (const a of alerts) {
    if (a.state === 'firing') firing += 1;
    else if (a.state === 'pending') pending += 1;
  }
  return { firing, pending, total: alerts.length };
}

// Split normalized rules by kind for the two-column alerts view.
export function partitionRules(rules: RuleView[]): {
  recording: RuleView[];
  alerting: RuleView[];
} {
  return {
    recording: rules.filter((r) => r.type === 'recording'),
    alerting: rules.filter((r) => r.type === 'alerting'),
  };
}
