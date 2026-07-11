// ─── App-reports aggregation (Builder Epic Phase 4B) — PURE, zero-IO ──────────────────────────────
//
// The analytics half of the builder lifecycle (screen 5). Given a set of app-run views (from
// listAppRunsView, Phase 4A), this rolls them up into the outcome metrics an operator cares about:
// how many runs, how many were approved vs rejected at a human step (HITL), how many hit exceptions
// or failed, throughput over time, and cost/tokens when a run's provenance/steps carry them. It is
// deliberately ZERO-IO — plain functions over the client-safe AppRunView shape — so it can be unit-
// tested exhaustively in isolation and shared between the RSC page and any future export. The page
// (thin I/O shell) reads the runs via the 4A reader and hands them here; the report SINK
// (adapters/sinks/report.ts) reuses the same rollup for a single run's report body.
//
// It does NOT re-declare the view types — it imports the client-safe AppRunView from app-runs-view.ts
// (which is itself import-free of `pg`), keeping this module free of any DB dependency.

import type { AppRunStepRow, AppRunView } from '@/lib/app-runs-view';

// ─── ReportMetrics — the rolled-up outcome view screen 5 renders ──────────────────────────────────
export interface ReportMetrics {
  totalRuns: number;
  // Run outcomes by terminal status.
  completed: number; // status 'done'
  failed: number; // status 'error'
  cancelled: number; // status 'cancelled'
  running: number; // still live (queued/running)
  awaitingReview: number; // paused at a human step
  // HITL decisions (across all human steps in all runs).
  approvals: number;
  rejections: number;
  approvalRate: number; // approvals / (approvals + rejections), 0..1; 0 when none decided
  // Exceptions — any step that errored (a run can fail on a step even if the run status differs).
  exceptions: number; // count of steps in status 'error'
  exceptionRate: number; // runs with ≥1 errored step / totalRuns, 0..1
  // Throughput + latency.
  throughputPerDay: number; // runs / span-in-days (≥1 day floor), 0 when no dated runs
  avgDurationMs: number | null; // mean wall-clock of terminal, timestamped runs; null when none
  // Cost / tokens (only when carried in run provenance/step detail; 0 when absent).
  totalTokens: number;
  totalCostUsd: number;
}

// ─── Human-step outcome vocabulary ────────────────────────────────────────────────────────────────
// A human step records its decision in `outcome`. We classify approve/reject leniently (case-
// insensitive, prefix match) so "approved", "Approve", "reject", "rejected" all count; anything else
// (e.g. an edited/other outcome) is neither an approval nor a rejection.
function humanDecision(outcome: string | undefined): 'approve' | 'reject' | null {
  const v = (outcome ?? '').trim().toLowerCase();
  if (v.startsWith('approv')) return 'approve';
  if (v.startsWith('reject')) return 'reject';
  return null;
}

// ─── computeReportMetrics — the master rollup (pure) ──────────────────────────────────────────────
export function computeReportMetrics(runs: AppRunView[]): ReportMetrics {
  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  let running = 0;
  let awaitingReview = 0;
  let approvals = 0;
  let rejections = 0;
  let exceptions = 0;
  let runsWithException = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;

  const durations: number[] = [];

  for (const run of runs) {
    switch (run.status) {
      case 'done':
        completed++;
        break;
      case 'error':
        failed++;
        break;
      case 'cancelled':
        cancelled++;
        break;
      case 'awaiting_human':
        awaitingReview++;
        break;
      default:
        running++; // queued | running | any unknown non-terminal
        break;
    }

    let runHadException = false;
    for (const step of run.steps ?? []) {
      if (step.status === 'error') {
        exceptions++;
        runHadException = true;
      }
      if (step.kind === 'human') {
        const d = humanDecision(step.outcome);
        if (d === 'approve') approvals++;
        else if (d === 'reject') rejections++;
      }
    }
    if (runHadException) runsWithException++;

    const cost = runCost(run);
    totalTokens += cost.tokens;
    totalCostUsd += cost.usd;

    const dur = runDurationMs(run);
    if (dur !== null) durations.push(dur);
  }

  const decided = approvals + rejections;
  const totalRuns = runs.length;

  return {
    totalRuns,
    completed,
    failed,
    cancelled,
    running,
    awaitingReview,
    approvals,
    rejections,
    approvalRate: decided > 0 ? approvals / decided : 0,
    exceptions,
    exceptionRate: totalRuns > 0 ? runsWithException / totalRuns : 0,
    throughputPerDay: computeThroughputPerDay(runs),
    avgDurationMs: durations.length ? Math.round(mean(durations)) : null,
    totalTokens,
    totalCostUsd: round2(totalCostUsd),
  };
}

// ─── runDurationMs — wall-clock of a run that has both timestamps ─────────────────────────────────
export function runDurationMs(run: Pick<AppRunView, 'startedAt' | 'finishedAt'>): number | null {
  if (!run.startedAt || !run.finishedAt) return null;
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

// ─── runCost — pull tokens/cost from provenance or step detail when present ───────────────────────
// Provenance/step shapes don't guarantee these fields, so we probe defensively for numeric
// `tokens`/`cost`/`costUsd` on the run's provenance and on each step. Absent → 0, never NaN.
export function runCost(run: AppRunView): { tokens: number; usd: number } {
  let tokens = 0;
  let usd = 0;
  const prov = run.provenance as unknown as Record<string, unknown> | null;
  if (prov) {
    tokens += num(prov.tokens);
    usd += num(prov.costUsd) || num(prov.cost);
  }
  for (const step of run.steps ?? []) {
    const s = step as unknown as Record<string, unknown>;
    tokens += num(s.tokens);
    usd += num(s.costUsd) || num(s.cost);
  }
  return { tokens, usd };
}

// ─── computeThroughputPerDay — runs per day across the observed span ──────────────────────────────
// Uses each run's startedAt. Span = latest − earliest start, floored at 1 day so a single-day burst
// reports its own count (not an inflated rate). Only dated runs count in both numerator + span.
export function computeThroughputPerDay(runs: Pick<AppRunView, 'startedAt'>[]): number {
  const times = runs
    .map((r) => (r.startedAt ? new Date(r.startedAt).getTime() : Number.NaN))
    .filter((t) => Number.isFinite(t)) as number[];
  if (times.length === 0) return 0;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const spanDays = Math.max(1, (max - min) / 86_400_000);
  return round2(times.length / spanDays);
}

// ─── TimeBucket — a day bucket for the throughput / outcomes-over-time chart ──────────────────────
export interface TimeBucket {
  day: string; // ISO date (YYYY-MM-DD), UTC
  total: number;
  completed: number;
  failed: number;
}

// ─── bucketByDay — group runs into UTC day buckets, ascending, gap-filled ─────────────────────────
// Only dated runs are bucketed. Returns a contiguous run of days from the earliest to the latest
// observed day (gaps filled with zero buckets) so a chart's x-axis is continuous, not jumpy.
export function bucketByDay(runs: AppRunView[]): TimeBucket[] {
  const dated = runs.filter((r) => r.startedAt);
  if (dated.length === 0) return [];

  const byDay = new Map<string, TimeBucket>();
  let minDay = Infinity;
  let maxDay = -Infinity;
  for (const r of dated) {
    const t = new Date(r.startedAt as string);
    const day = t.toISOString().slice(0, 10);
    const dayMs = Date.parse(day);
    minDay = Math.min(minDay, dayMs);
    maxDay = Math.max(maxDay, dayMs);
    const b = byDay.get(day) ?? { day, total: 0, completed: 0, failed: 0 };
    b.total++;
    if (r.status === 'done') b.completed++;
    else if (r.status === 'error') b.failed++;
    byDay.set(day, b);
  }

  // Gap-fill from minDay..maxDay inclusive.
  const out: TimeBucket[] = [];
  for (let ms = minDay; ms <= maxDay; ms += 86_400_000) {
    const day = new Date(ms).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, total: 0, completed: 0, failed: 0 });
  }
  return out;
}

// ─── stepKindBreakdown — how many steps of each kind ran across all runs ──────────────────────────
// Feeds the "what these apps actually do" mix (agent vs connector-query vs guardrail vs human vs
// output). Counts every step across every run, keyed by kind.
export function stepKindBreakdown(runs: AppRunView[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const run of runs) {
    for (const step of run.steps ?? []) {
      out[step.kind] = (out[step.kind] ?? 0) + 1;
    }
  }
  return out;
}

// ─── singleRunSummary — the rollup for ONE run, used by the report sink ───────────────────────────
// The report of a single app-run needs a tighter shape than the fleet metrics: its step outcomes and
// its own cost/duration. Kept pure here so the sink stays a thin renderer.
export interface RunSummary {
  id: string;
  appId: string;
  status: string;
  stepCount: number;
  stepsDone: number;
  stepsErrored: number;
  humanDecisions: { approvals: number; rejections: number };
  durationMs: number | null;
  tokens: number;
  costUsd: number;
}

export function singleRunSummary(run: AppRunView): RunSummary {
  const steps = run.steps ?? [];
  let approvals = 0;
  let rejections = 0;
  for (const s of steps) {
    if (s.kind === 'human') {
      const d = humanDecision(s.outcome);
      if (d === 'approve') approvals++;
      else if (d === 'reject') rejections++;
    }
  }
  const cost = runCost(run);
  return {
    id: run.id,
    appId: run.appId,
    status: run.status,
    stepCount: steps.length,
    stepsDone: steps.filter((s: AppRunStepRow) => s.status === 'done').length,
    stepsErrored: steps.filter((s: AppRunStepRow) => s.status === 'error').length,
    humanDecisions: { approvals, rejections },
    durationMs: runDurationMs(run),
    tokens: cost.tokens,
    costUsd: round2(cost.usd),
  };
}

// ─── ReportStatTile — a value-forward tile for screen 5's stat band ───────────────────────────────
// Mirrors the insights StatTile shape (label/value/tone) so the shared <StatBand> renders it, but is
// built here (pure) from ReportMetrics so the page stays a thin shell. Tone rules: failures/rejections
// go bad only when non-zero; a clean fleet reads calm.
export type ReportStatTone = 'default' | 'good' | 'warn' | 'bad';
export interface ReportStatTile {
  label: string;
  value: string;
  tone: ReportStatTone;
}

export function buildReportStats(m: ReportMetrics): ReportStatTile[] {
  return [
    { label: 'Total runs', value: fmtInt(m.totalRuns), tone: 'default' },
    {
      label: 'Completed',
      value: fmtInt(m.completed),
      tone: m.completed > 0 ? 'good' : 'default',
    },
    { label: 'Failed', value: fmtInt(m.failed), tone: m.failed > 0 ? 'bad' : 'good' },
    {
      label: 'Approval rate',
      value: m.approvals + m.rejections > 0 ? `${Math.round(m.approvalRate * 100)}%` : '—',
      tone: 'default',
    },
    {
      label: 'Exceptions',
      value: fmtInt(m.exceptions),
      tone: m.exceptions > 0 ? 'warn' : 'good',
    },
    { label: 'Throughput / day', value: String(m.throughputPerDay), tone: 'default' },
    {
      label: 'Avg duration',
      value: m.avgDurationMs === null ? '—' : fmtMs(m.avgDurationMs),
      tone: 'default',
    },
    {
      label: 'Cost',
      value: m.totalTokens > 0 || m.totalCostUsd > 0 ? `$${m.totalCostUsd.toFixed(2)}` : '—',
      tone: 'default',
    },
  ];
}

function fmtInt(n: number): string {
  return Number.isFinite(n) ? Math.trunc(n).toLocaleString() : '—';
}
function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

// ─── helpers ──────────────────────────────────────────────────────────────────────────────────────
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
