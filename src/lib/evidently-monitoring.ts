// ─── PURE drift-monitoring system-of-record logic ───────────────────────────────────────────────
//
// The drift adapter (adapters/drift.ts) produces stateless per-run verdicts; drift-runs.ts RETAINS
// each run with its engine attribution. This module is the PURE brain of the console-owned monitoring
// LAYER built on top of those retained runs: it validates a monitoring PROJECT (a named grouping with
// a breach threshold), normalizes retained runs into a time-ordered REPORT HISTORY, and shapes the
// runs into a drift-share-over-time TREND series with threshold-breach detection. Zero I/O so it is
// fully unit-testable; the store/route feed it real data. Attribution normalization is reused from
// drift-run.ts (DRY) — this module never re-implements engine-provenance logic.

import { describeDriftAttribution, type DriftAttributionView } from '@/lib/drift-run';
import type { DriftRun } from '@/lib/drift-runs';

// The default breach line — matches the PSI "drift" threshold in adapters/drift.ts (0.25) so a
// project with no explicit threshold flags the same shares the engine already calls drift.
export const DEFAULT_DRIFT_THRESHOLD = 0.25;
export const MAX_NAME_LEN = 120;
export const MAX_DESC_LEN = 1000;
export const MAX_DATASET_LEN = 200;

export type TrendGranularity = 'hour' | 'day';
export type DriftDisplayStatus = 'drift' | 'warning' | 'stable';

// ─── project validation / normalization ─────────────────────────────────────────────────────────
export interface DriftProjectInput {
  name?: unknown;
  description?: unknown;
  dataset?: unknown;
  driftThreshold?: unknown;
}

export interface NormalizedDriftProject {
  name: string;
  description: string;
  dataset: string;
  driftThreshold: number; // 0..1
}

export interface ProjectValidation {
  ok: boolean;
  errors: string[];
  value: NormalizedDriftProject | null;
}

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Validate + normalize a proposed monitoring project. PURE. `name` is required; `driftThreshold`,
 * when supplied, must be a finite number in [0,1] (else it's an error, never silently clamped) —
 * absent falls back to DEFAULT_DRIFT_THRESHOLD.
 */
export function validateDriftProject(input: DriftProjectInput): ProjectValidation {
  const errors: string[] = [];
  const name = trimStr(input.name);
  if (!name) errors.push('name is required.');
  else if (name.length > MAX_NAME_LEN) errors.push(`name must be ≤ ${MAX_NAME_LEN} characters.`);

  const description = trimStr(input.description);
  if (description.length > MAX_DESC_LEN) {
    errors.push(`description must be ≤ ${MAX_DESC_LEN} characters.`);
  }

  const dataset = trimStr(input.dataset);
  if (dataset.length > MAX_DATASET_LEN) {
    errors.push(`dataset must be ≤ ${MAX_DATASET_LEN} characters.`);
  }

  let driftThreshold = DEFAULT_DRIFT_THRESHOLD;
  if (input.driftThreshold !== undefined && input.driftThreshold !== null) {
    const t = typeof input.driftThreshold === 'number' ? input.driftThreshold : Number(input.driftThreshold);
    if (!Number.isFinite(t) || t < 0 || t > 1) {
      errors.push('driftThreshold must be a number between 0 and 1.');
    } else {
      driftThreshold = t;
    }
  }

  if (errors.length > 0) return { ok: false, errors, value: null };
  return { ok: true, errors: [], value: { name, description, dataset, driftThreshold } };
}

// ─── report history ──────────────────────────────────────────────────────────────────────────────
export interface DriftReportEntry {
  id: string;
  startedAt: string;
  engine: string;
  engineLabel: string;
  engineProven: boolean;
  driftShare: number | null;
  driftPct: number | null;
  status: DriftDisplayStatus;
  baseline: number;
  current: number;
  method: string;
  fallbackReason: string | null;
}

function normalizeStatus(raw: string): DriftDisplayStatus {
  return raw === 'drift' || raw === 'warning' ? raw : 'stable';
}

function entryFromRun(run: DriftRun): DriftReportEntry {
  // Reuse the canonical attribution normalizer (DRY) — engineProven/engineLabel are decided in ONE
  // place. Fall back to the row's own columns when a legacy run has no attribution blob.
  const attr: DriftAttributionView | null = describeDriftAttribution(
    run.attribution as Record<string, unknown> | null,
  );
  const driftShare = attr?.driftShare ?? run.driftShare;
  return {
    id: run.id,
    startedAt: run.startedAt,
    engine: attr?.engine ?? run.engine,
    engineLabel: attr?.engineLabel ?? (run.engine === 'evidently' ? 'Evidently' : 'Off Grid PSI'),
    engineProven: attr?.engineProven ?? false,
    driftShare: driftShare,
    driftPct: driftShare === null ? null : Math.round(driftShare * 100),
    status: normalizeStatus(attr?.status ?? run.status),
    baseline: attr?.baseline ?? run.baseline,
    current: attr?.current ?? run.current,
    method: attr?.method ?? 'default drift',
    fallbackReason: attr?.fallbackReason ?? null,
  };
}

/** Normalize retained runs into a report history, newest-first. PURE. */
export function normalizeReportHistory(runs: DriftRun[]): DriftReportEntry[] {
  return runs
    .map(entryFromRun)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
}

// ─── trend series ────────────────────────────────────────────────────────────────────────────────
export interface TrendPoint {
  bucket: string; // bucket key (YYYY-MM-DD, or YYYY-MM-DDTHH for hourly)
  driftShare: number; // mean drift share over the bucket, 0..1
  driftPct: number; // 0..100
  status: DriftDisplayStatus; // worst status in the bucket
  runs: number; // runs that fell in the bucket
  breach: boolean; // mean share ≥ threshold
}

export interface TrendSeries {
  points: TrendPoint[]; // ascending by time
  threshold: number;
  breaches: number; // number of breaching buckets
  latestBreachAt: string | null; // bucket key of the most recent breach
  direction: 'up' | 'down' | 'flat';
  peak: number; // max mean drift share across buckets (0..1)
  peakPct: number; // 0..100
}

function bucketKey(iso: string, granularity: TrendGranularity): string {
  // Runs persist an ISO timestamp; the date-portion is a stable bucket key without TZ math.
  return granularity === 'hour' ? iso.slice(0, 13) : iso.slice(0, 10);
}

const RANK: Record<DriftDisplayStatus, number> = { stable: 0, warning: 1, drift: 2 };
function worst(a: DriftDisplayStatus, b: DriftDisplayStatus): DriftDisplayStatus {
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * Shape retained runs into a drift-share-over-time series. PURE. Runs with no drift share are skipped
 * (nothing to plot). Runs are bucketed by day (or hour); each bucket carries the MEAN share, the
 * WORST status, and whether the mean breached `threshold`. `direction` compares the first vs last
 * bucket so an operator sees whether drift is trending up.
 */
export function buildTrendSeries(
  runs: DriftRun[],
  opts: { threshold?: number; granularity?: TrendGranularity } = {},
): TrendSeries {
  const threshold = Number.isFinite(opts.threshold) ? (opts.threshold as number) : DEFAULT_DRIFT_THRESHOLD;
  const granularity = opts.granularity ?? 'day';

  const buckets = new Map<string, { sum: number; n: number; status: DriftDisplayStatus }>();
  for (const run of runs) {
    if (run.driftShare === null || !Number.isFinite(run.driftShare)) continue;
    const key = bucketKey(run.startedAt, granularity);
    const cur = buckets.get(key);
    const status = normalizeStatus(run.status);
    if (cur) {
      cur.sum += run.driftShare;
      cur.n += 1;
      cur.status = worst(cur.status, status);
    } else {
      buckets.set(key, { sum: run.driftShare, n: 1, status });
    }
  }

  const points: TrendPoint[] = [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([bucket, agg]) => {
      const driftShare = Number((agg.sum / agg.n).toFixed(4));
      return {
        bucket,
        driftShare,
        driftPct: Math.round(driftShare * 100),
        status: agg.status,
        runs: agg.n,
        breach: driftShare >= threshold,
      };
    });

  const breaching = points.filter((p) => p.breach);
  const peak = points.reduce((m, p) => (p.driftShare > m ? p.driftShare : m), 0);

  let direction: TrendSeries['direction'] = 'flat';
  if (points.length >= 2) {
    const delta = points[points.length - 1].driftShare - points[0].driftShare;
    if (delta > 0.01) direction = 'up';
    else if (delta < -0.01) direction = 'down';
  }

  return {
    points,
    threshold,
    breaches: breaching.length,
    latestBreachAt: breaching.length ? breaching[breaching.length - 1].bucket : null,
    direction,
    peak,
    peakPct: Math.round(peak * 100),
  };
}

// ─── list-card signal (composes history + trend for a project row) ─────────────────────────────────
export interface ProjectSignal {
  reportCount: number;
  latest: DriftReportEntry | null;
  direction: TrendSeries['direction'];
  breaches: number;
  peakPct: number;
}

/**
 * A compact per-project summary for the list surface, computed from the org's retained runs and the
 * project's threshold. PURE — reuses the history + trend shapers rather than re-deriving anything.
 */
export function projectSignal(threshold: number, runs: DriftRun[]): ProjectSignal {
  const history = normalizeReportHistory(runs);
  const trend = buildTrendSeries(runs, { threshold });
  return {
    reportCount: history.length,
    latest: history[0] ?? null,
    direction: trend.direction,
    breaches: trend.breaches,
    peakPct: trend.peakPct,
  };
}
