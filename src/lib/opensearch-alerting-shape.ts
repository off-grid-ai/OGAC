// PURE request/response shaping for OpenSearch alerting (monitors/triggers) + ISM (index lifecycle).
// Zero imports, zero I/O — fully unit-testable in isolation. The thin network shell that PUTs/GETs
// these against OpenSearch's `_plugins/_alerting/*` and `_plugins/_ism/*` APIs lives in
// `opensearch-alerting.ts`; this file never fetches.
//
// Two operator-facing surfaces are shaped here:
//   1. ALERTING MONITORS — a per-index query monitor over the audit/gateway indices with a single
//      threshold trigger, e.g. "alert when blocked outcomes > N in the last 5 minutes". We build the
//      `_plugins/_alerting/monitors` create/update body (a `query_level_monitor` with a
//      `search`-input + a `script`-condition trigger) and parse the monitor-list response back into a
//      flat display model.
//   2. ISM POLICIES — a retention/rollover policy for `_plugins/_ism/policies`. We build a minimal
//      hot→delete state machine (rollover by age/size, delete after a retention window) and parse the
//      policy-get response back into a flat display model.

// ── Monitor display + input model ───────────────────────────────────────────────────────────────

/** The comparison a trigger fires on. */
export type ThresholdOp = 'gt' | 'gte' | 'lt' | 'lte';

/** A normalized monitor as the console edits it — the minimal, opinionated shape we support. */
export interface MonitorSpec {
  /** Monitor name (unique-ish, operator-chosen). */
  name: string;
  /** Index (or index pattern) the monitor searches, e.g. `offgrid-audit`. */
  index: string;
  /** Exact-match on the audit `outcome` field the monitor counts, e.g. `blocked`. Empty = count all. */
  outcome: string;
  /** Look-back window in minutes — the monitor counts matching docs in the last `windowMinutes`. */
  windowMinutes: number;
  /** How often the monitor runs, in minutes. */
  intervalMinutes: number;
  /** Fire the trigger when the matching-doc count crosses this threshold. */
  threshold: number;
  /** Comparison operator for the threshold. */
  op: ThresholdOp;
  /** Whether the monitor is enabled. */
  enabled: boolean;
  /** Optional trigger name (defaults derived). */
  triggerName?: string;
}

/** A monitor as read back from OpenSearch (flattened for display). */
export interface MonitorSummary {
  id: string;
  name: string;
  enabled: boolean;
  index: string;
  intervalMinutes: number | null;
  /** The primary trigger's threshold + op, when we can recover it. */
  threshold: number | null;
  op: ThresholdOp | null;
  triggerName: string | null;
  /** Sequence numbers OpenSearch requires for optimistic-concurrency updates (if present). */
  seqNo: number | null;
  primaryTerm: number | null;
}

const OPS = new Set<ThresholdOp>(['gt', 'gte', 'lt', 'lte']);

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(n, min), max);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Clamp/normalise untrusted monitor input; returns null when unusable (no name or no index). */
export function normalizeMonitorSpec(input: {
  name?: unknown;
  index?: unknown;
  outcome?: unknown;
  windowMinutes?: unknown;
  intervalMinutes?: unknown;
  threshold?: unknown;
  op?: unknown;
  enabled?: unknown;
  triggerName?: unknown;
}): MonitorSpec | null {
  const name = str(input.name).slice(0, 255);
  const index = str(input.index).slice(0, 255);
  if (!name || !index) return null;
  const op = OPS.has(input.op as ThresholdOp) ? (input.op as ThresholdOp) : 'gt';
  return {
    name,
    index,
    outcome: str(input.outcome).slice(0, 255),
    windowMinutes: clampInt(input.windowMinutes, 1, 10080, 5),
    intervalMinutes: clampInt(input.intervalMinutes, 1, 10080, 5),
    threshold: clampInt(input.threshold, 0, 1_000_000_000, 1),
    op,
    enabled: input.enabled !== false,
    triggerName: str(input.triggerName) || undefined,
  };
}

/** Painless comparison operator for a trigger condition. */
export function opToPainless(op: ThresholdOp): string {
  switch (op) {
    case 'gt':
      return '>';
    case 'gte':
      return '>=';
    case 'lt':
      return '<';
    case 'lte':
      return '<=';
  }
}

/**
 * Build the `_plugins/_alerting/monitors` create/update body for a query-level monitor. The monitor
 * runs on a fixed minute interval and searches the target index for docs in the last `windowMinutes`
 * that match the outcome (a `bool` filter over `ts` + optional `outcome.keyword`). The single trigger
 * fires when `ctx.results[0].hits.total.value <op> threshold`.
 */
export function buildMonitorBody(spec: MonitorSpec): Record<string, unknown> {
  const filter: Record<string, unknown>[] = [
    { range: { ts: { gte: `now-${spec.windowMinutes}m`, lte: 'now' } } },
  ];
  if (spec.outcome) filter.push({ term: { 'outcome.keyword': spec.outcome } });

  const triggerName = spec.triggerName ?? `${spec.name}-trigger`;
  const source = `ctx.results[0].hits.total.value ${opToPainless(spec.op)} ${spec.threshold}`;

  return {
    type: 'monitor',
    monitor_type: 'query_level_monitor',
    name: spec.name,
    enabled: spec.enabled,
    schedule: { period: { interval: spec.intervalMinutes, unit: 'MINUTES' } },
    inputs: [
      {
        search: {
          indices: [spec.index],
          query: {
            size: 0,
            query: { bool: { filter } },
          },
        },
      },
    ],
    triggers: [
      {
        name: triggerName,
        severity: '1',
        condition: {
          script: { source, lang: 'painless' },
        },
        actions: [],
      },
    ],
  };
}

/** Recover a threshold `op` + number from a Painless condition source string, best-effort. */
export function parseCondition(source: unknown): {
  op: ThresholdOp | null;
  threshold: number | null;
} {
  const s = typeof source === 'string' ? source : '';
  const m = /(>=|<=|>|<)\s*(\d+)/.exec(s);
  if (!m) return { op: null, threshold: null };
  const opMap: Record<string, ThresholdOp> = { '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' };
  return { op: opMap[m[1]] ?? null, threshold: Number(m[2]) };
}

// ── Monitor list-response parsing ────────────────────────────────────────────────────────────────
// OpenSearch's `_plugins/_alerting/monitors/_search` returns an ES-style hits envelope; a single-GET
// (`/monitors/<id>`) returns `{ _id, _version, _seq_no, _primary_term, monitor: {...} }`. We handle
// both by reading the monitor from `_source` or `monitor`.

interface RawMonitorHit {
  _id?: string;
  _seq_no?: number;
  _primary_term?: number;
  _source?: Record<string, unknown>;
  monitor?: Record<string, unknown>;
}

function flattenMonitor(hit: RawMonitorHit): MonitorSummary {
  const m = (hit._source ?? hit.monitor ?? {}) as Record<string, unknown>;
  const schedule = (m.schedule as { period?: { interval?: unknown } } | undefined)?.period;
  const inputs = Array.isArray(m.inputs) ? (m.inputs as Record<string, unknown>[]) : [];
  const firstSearch = inputs[0]?.search as { indices?: unknown[] } | undefined;
  const index = Array.isArray(firstSearch?.indices) ? str(firstSearch?.indices?.[0]) : '';
  const triggers = Array.isArray(m.triggers) ? (m.triggers as Record<string, unknown>[]) : [];
  const t0 = triggers[0];
  const cond = (t0?.condition as { script?: { source?: unknown } } | undefined)?.script?.source;
  const { op, threshold } = parseCondition(cond);
  return {
    id: str(hit._id),
    name: str(m.name),
    enabled: m.enabled !== false,
    index,
    intervalMinutes: schedule?.interval != null ? Number(schedule.interval) : null,
    threshold,
    op,
    triggerName: t0 ? str(t0.name) || null : null,
    seqNo: typeof hit._seq_no === 'number' ? hit._seq_no : null,
    primaryTerm: typeof hit._primary_term === 'number' ? hit._primary_term : null,
  };
}

/** Parse a monitor search/list response (hits envelope) into flat summaries, name-sorted. */
export function parseMonitorList(
  json: { hits?: { hits?: RawMonitorHit[] } } | null | undefined,
): MonitorSummary[] {
  const hits = json?.hits?.hits ?? [];
  return hits.map(flattenMonitor).sort((a, b) => a.name.localeCompare(b.name));
}

/** Parse a single monitor-GET response (`{ _id, monitor }`) into one summary. */
export function parseMonitorGet(json: RawMonitorHit | null | undefined): MonitorSummary | null {
  if (!json || (!json.monitor && !json._source)) return null;
  return flattenMonitor(json);
}

// ── ISM policy shaping ───────────────────────────────────────────────────────────────────────────

/** The retention policy the console edits — a minimal hot→delete lifecycle over an index pattern. */
export interface IsmPolicySpec {
  /** Policy id, e.g. `offgrid-audit-retention`. */
  policyId: string;
  /** Index patterns this policy is applied to via ism_template, e.g. `['offgrid-audit*']`. */
  indexPatterns: string[];
  /** Roll the write index over once it is this many days old (0 disables age-rollover). */
  rolloverAgeDays: number;
  /** Roll over once the primary shard reaches this size in GB (0 disables size-rollover). */
  rolloverSizeGb: number;
  /** Delete an index this many days after rollover (the retention window). Must be ≥ 1. */
  retentionDays: number;
  /** Optional human description. */
  description?: string;
}

/** Clamp/normalise untrusted ISM input; null when unusable (no policyId). */
export function normalizeIsmPolicy(input: {
  policyId?: unknown;
  indexPatterns?: unknown;
  rolloverAgeDays?: unknown;
  rolloverSizeGb?: unknown;
  retentionDays?: unknown;
  description?: unknown;
}): IsmPolicySpec | null {
  const policyId = str(input.policyId).slice(0, 255);
  if (!policyId) return null;
  const retentionDays = clampInt(input.retentionDays, 1, 3650, 30);
  const patterns = Array.isArray(input.indexPatterns)
    ? input.indexPatterns
        .map((p) => str(p))
        .filter(Boolean)
        .slice(0, 20)
    : [];
  return {
    policyId,
    indexPatterns: patterns.length ? patterns : [`${policyId.replace(/-retention$/, '')}*`],
    rolloverAgeDays: clampInt(input.rolloverAgeDays, 0, 3650, 0),
    rolloverSizeGb: clampInt(input.rolloverSizeGb, 0, 10000, 0),
    retentionDays,
    description: str(input.description) || undefined,
  };
}

/**
 * Build the `_plugins/_ism/policies/<id>` PUT body: a two-state policy (`hot` → `delete`). `hot`
 * carries a rollover action gated by age/size; after `retentionDays` the index transitions to
 * `delete`, which deletes it. An `ism_template` binds the policy to the index patterns automatically.
 */
export function buildIsmPolicyBody(spec: IsmPolicySpec): Record<string, unknown> {
  const rollover: Record<string, unknown> = {};
  if (spec.rolloverAgeDays > 0) rollover.min_index_age = `${spec.rolloverAgeDays}d`;
  if (spec.rolloverSizeGb > 0) rollover.min_primary_shard_size = `${spec.rolloverSizeGb}gb`;

  const hotActions: Record<string, unknown>[] =
    Object.keys(rollover).length > 0 ? [{ rollover }] : [];

  return {
    policy: {
      policy_id: spec.policyId,
      description: spec.description ?? `Retention policy for ${spec.indexPatterns.join(', ')}`,
      default_state: 'hot',
      states: [
        {
          name: 'hot',
          actions: hotActions,
          transitions: [
            { state_name: 'delete', conditions: { min_index_age: `${spec.retentionDays}d` } },
          ],
        },
        {
          name: 'delete',
          actions: [{ delete: {} }],
          transitions: [],
        },
      ],
      ism_template: [{ index_patterns: spec.indexPatterns, priority: 100 }],
    },
  };
}

/** An ISM policy as read back (flattened for display). */
export interface IsmPolicySummary {
  policyId: string;
  description: string;
  indexPatterns: string[];
  rolloverAgeDays: number | null;
  rolloverSizeGb: number | null;
  retentionDays: number | null;
  /** Sequence numbers for optimistic-concurrency updates. */
  seqNo: number | null;
  primaryTerm: number | null;
}

function daysFromAge(v: unknown): number | null {
  const m = typeof v === 'string' ? /^(\d+)\s*d$/.exec(v) : null;
  return m ? Number(m[1]) : null;
}
function gbFromSize(v: unknown): number | null {
  const m = typeof v === 'string' ? /^(\d+)\s*gb$/i.exec(v) : null;
  return m ? Number(m[1]) : null;
}

/**
 * Parse a `_plugins/_ism/policies/<id>` GET response (`{ _id, _seq_no, _primary_term, policy }`)
 * back into a flat summary. Tolerant of missing pieces — a policy without a rollover action just
 * yields null rollover fields.
 */
export function parseIsmPolicy(
  json:
    | {
        _id?: string;
        _seq_no?: number;
        _primary_term?: number;
        policy?: Record<string, unknown>;
      }
    | null
    | undefined,
): IsmPolicySummary | null {
  const p = json?.policy;
  if (!p) return null;
  const states = Array.isArray(p.states) ? (p.states as Record<string, unknown>[]) : [];
  const templates = Array.isArray(p.ism_template)
    ? (p.ism_template as { index_patterns?: unknown[] }[])
    : [];
  const patterns = templates.flatMap((t) =>
    Array.isArray(t.index_patterns) ? t.index_patterns.map((x) => str(x)).filter(Boolean) : [],
  );

  let rolloverAgeDays: number | null = null;
  let rolloverSizeGb: number | null = null;
  let retentionDays: number | null = null;
  for (const st of states) {
    const actions = Array.isArray(st.actions) ? (st.actions as Record<string, unknown>[]) : [];
    for (const a of actions) {
      const ro = a.rollover as
        | { min_index_age?: unknown; min_primary_shard_size?: unknown }
        | undefined;
      if (ro) {
        rolloverAgeDays = daysFromAge(ro.min_index_age) ?? rolloverAgeDays;
        rolloverSizeGb = gbFromSize(ro.min_primary_shard_size) ?? rolloverSizeGb;
      }
    }
    const transitions = Array.isArray(st.transitions)
      ? (st.transitions as { state_name?: unknown; conditions?: { min_index_age?: unknown } }[])
      : [];
    for (const tr of transitions) {
      if (str(tr.state_name) === 'delete') {
        retentionDays = daysFromAge(tr.conditions?.min_index_age) ?? retentionDays;
      }
    }
  }

  return {
    policyId: str(p.policy_id) || str(json?._id),
    description: str(p.description),
    indexPatterns: patterns,
    rolloverAgeDays,
    rolloverSizeGb,
    retentionDays,
    seqNo: typeof json?._seq_no === 'number' ? json._seq_no : null,
    primaryTerm: typeof json?._primary_term === 'number' ? json._primary_term : null,
  };
}

/** Detect whether an OpenSearch error status/body indicates the plugin/API simply isn't installed. */
export function isPluginUnsupported(status: number, body: string): boolean {
  if (status === 404 || status === 405 || status === 501) return true;
  return /no handler found|not found for uri|does not exist.*_plugins/i.test(body);
}
