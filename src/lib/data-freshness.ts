// ─── M4 data governance — the PURE freshness-SLA + broken-sync evaluator (zero-I/O) ────────────
//
// A silent bad sync is the nightmare: an exec dashboard reads a warehouse table that stopped
// refreshing three days ago and nobody knows. Freshness governance makes staleness LOUD. Each asset
// declares a freshness SLA (max hours since last refresh). This module, given the asset's SLA + its
// last-refresh time + last sync status, decides the freshness STATE — purely, so it's testable
// without a clock or a DB (the caller passes `now`).
//
// SOLID: the rule (fresh vs stale vs broken) lives here; the store supplies the facts; the UI badges
// the result; nothing re-derives it.

// Freshness states, worst-first for sorting an alert list.
export type FreshnessState = 'broken' | 'stale' | 'fresh' | 'unknown' | 'no-sla';

// The facts the evaluator needs about one asset. All optional/nullable so a barely-registered asset
// (no SLA, never refreshed) evaluates cleanly to 'unknown'/'no-sla' rather than throwing.
export interface FreshnessInput {
  /** Max hours allowed since the last refresh. 0/absent = no SLA declared. */
  freshnessSlaHours?: number | null;
  /** When the asset last successfully refreshed. */
  lastRefreshAt?: Date | string | null;
  /** Last reported sync status: 'ok' | 'failed' | 'unknown'. */
  syncStatus?: string | null;
}

export interface FreshnessResult {
  state: FreshnessState;
  /** Whole hours since last refresh, or null if never refreshed. */
  ageHours: number | null;
  /** The SLA that was applied (hours), or null if none. */
  slaHours: number | null;
  /** True when this asset should raise an alert (broken or stale). */
  alerting: boolean;
  /** Human reason, for the UI/tooltip. */
  reason: string;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Evaluate one asset's freshness. PURE — `now` is injected so tests are deterministic.
// Precedence: a failed sync is BROKEN regardless of age (the data may look fresh but is wrong);
// then no-SLA short-circuits (can't be stale against no target); then age vs SLA.
export function evaluateFreshness(input: FreshnessInput, now: Date = new Date()): FreshnessResult {
  const sla = typeof input.freshnessSlaHours === 'number' && input.freshnessSlaHours > 0
    ? Math.floor(input.freshnessSlaHours)
    : null;
  const last = toDate(input.lastRefreshAt);
  const ageHours = last ? Math.floor((now.getTime() - last.getTime()) / 3_600_000) : null;
  const status = (input.syncStatus ?? '').trim().toLowerCase();

  // A failed sync is broken — the loudest state — even if the last-good data is within SLA.
  if (status === 'failed') {
    return {
      state: 'broken',
      ageHours,
      slaHours: sla,
      alerting: true,
      reason: 'Last sync failed — data may be missing or wrong.',
    };
  }

  if (sla == null) {
    return {
      state: 'no-sla',
      ageHours,
      slaHours: null,
      alerting: false,
      reason: 'No freshness SLA set for this asset.',
    };
  }

  if (last == null || ageHours == null) {
    return {
      state: 'unknown',
      ageHours: null,
      slaHours: sla,
      alerting: false,
      reason: 'Never refreshed — waiting on the first sync.',
    };
  }

  if (ageHours > sla) {
    return {
      state: 'stale',
      ageHours,
      slaHours: sla,
      alerting: true,
      reason: `Last refresh ${ageHours}h ago, over the ${sla}h SLA.`,
    };
  }

  return {
    state: 'fresh',
    ageHours,
    slaHours: sla,
    alerting: false,
    reason: `Refreshed ${ageHours}h ago, within the ${sla}h SLA.`,
  };
}

// Roll a set of evaluated assets up into a fleet-wide freshness summary for the governance banner.
export interface FreshnessSummary {
  total: number;
  fresh: number;
  stale: number;
  broken: number;
  unknown: number;
  noSla: number;
  /** total assets currently alerting (stale + broken). */
  alerting: number;
}

export function summarizeFreshness(results: readonly FreshnessResult[]): FreshnessSummary {
  const s: FreshnessSummary = {
    total: results.length, fresh: 0, stale: 0, broken: 0, unknown: 0, noSla: 0, alerting: 0,
  };
  for (const r of results) {
    if (r.state === 'fresh') s.fresh += 1;
    else if (r.state === 'stale') s.stale += 1;
    else if (r.state === 'broken') s.broken += 1;
    else if (r.state === 'unknown') s.unknown += 1;
    else if (r.state === 'no-sla') s.noSla += 1;
    if (r.alerting) s.alerting += 1;
  }
  return s;
}
