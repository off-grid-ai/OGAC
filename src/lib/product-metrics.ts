// ─── §13 product success metrics — pure ────────────────────────────────────────────────────────────
//
// `docs/roadmap-real.md` §13 opens by rejecting the obvious measures: *"OGAC should not be measured by
// prompts or model calls."* Auditing that section produced the sharpest finding of the whole pass —
// almost every metric it names is DERIVABLE from data already recorded, and almost none is COMPUTED.
// Runs, policy decisions, review decisions, template and pipeline bindings are all in the database; the
// aggregations simply do not exist.
//
// That is the same defect class as the five boundary bugs found this session (information present,
// discarded at the last step), applied to the product's own scoreboard. And it is self-referential: the
// document says the product wins by making an enterprise measurably faster, and the product cannot
// currently measure that about itself.
//
// This module is the missing computation, kept pure so it is exhaustively testable with no DB. Every
// function takes rows and returns a number or a ratio. The I/O that fetches those rows belongs in a thin
// reader, exactly like app-runs-view.ts / app-runs-view-reader.ts.
//
// WHAT IS DELIBERATELY ABSENT. §13 also asks for hours saved, cost per completed process, error
// reduction and revenue. Those need a BASELINE — what the work cost before — and nothing captures it.
// Computing them from run counts alone would be invention, so they are not here. A metric we cannot
// source is left uncomputed rather than estimated; that is the same rule as not inventing a currency
// symbol.

/** A completed or in-flight run, reduced to what these metrics need. */
export interface MetricRun {
  id: string;
  status: string; // done | error | awaiting_human | running | …
  appId?: string;
  pipelineId?: string | null;
  startedAt?: string;
  finishedAt?: string;
}

/** One audited decision. `outcome` follows the ledger's vocabulary. */
export interface MetricAudit {
  action: string;
  outcome: 'ok' | 'blocked' | 'redacted' | 'error' | string;
}

/** An app, reduced to the bindings §13's reuse and governance groups count. */
export interface MetricApp {
  id: string;
  pipelineId?: string | null;
  templateId?: string | null;
  hasEvaluations?: boolean;
}

/** A ratio reported as both parts and a percentage, so a reader can see what it is OF. */
export interface Ratio {
  numerator: number;
  denominator: number;
  /** 0–100, rounded. `null` when the denominator is 0 — never 0%, which would read as a real measurement. */
  pct: number | null;
}

/**
 * Build a ratio.
 *
 * An empty denominator yields `pct: null`, not 0. "0% of apps have evaluations" and "no apps exist" are
 * different facts, and a dashboard that shows the first when the second is true is the same lie as a
 * failed read reporting "no rows".
 */
export function ratio(numerator: number, denominator: number): Ratio {
  return {
    numerator,
    denominator,
    pct: denominator > 0 ? Math.round((numerator / denominator) * 100) : null,
  };
}

// ─── Reliability ────────────────────────────────────────────────────────────────────────────────────

/** Runs that finished successfully. */
export function successfulRuns(runs: readonly MetricRun[]): number {
  return runs.filter((r) => r.status === 'done').length;
}

/** Runs that failed. Distinct from "did not succeed" — a run awaiting a person has NOT failed. */
export function failedRuns(runs: readonly MetricRun[]): number {
  return runs.filter((r) => r.status === 'error').length;
}

/**
 * Success rate over runs that actually REACHED a terminal state.
 *
 * In-flight and awaiting-human runs are excluded from the denominator on purpose: counting a run that is
 * correctly paused for an approver as a non-success would penalise the product for doing the governed
 * thing, and would make the number drift with how promptly humans happen to review.
 */
export function runSuccessRate(runs: readonly MetricRun[]): Ratio {
  const terminal = runs.filter((r) => r.status === 'done' || r.status === 'error');
  return ratio(terminal.filter((r) => r.status === 'done').length, terminal.length);
}

/** Blocked policy decisions — the document's "number of blocked policy violations". */
export function blockedViolations(events: readonly MetricAudit[]): number {
  return events.filter((e) => e.outcome === 'blocked').length;
}

/** Median wall-clock seconds for terminal runs. Median, not mean: one stuck run should not move it. */
export function medianRunSeconds(runs: readonly MetricRun[]): number | null {
  const durations = runs
    .filter((r) => r.startedAt && r.finishedAt)
    .map((r) => (Date.parse(r.finishedAt as string) - Date.parse(r.startedAt as string)) / 1000)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  if (durations.length === 0) return null;
  const mid = Math.floor(durations.length / 2);
  const median =
    durations.length % 2 === 0 ? (durations[mid - 1] + durations[mid]) / 2 : durations[mid];
  return Math.round(median * 10) / 10;
}

// ─── Reuse — the cheapest group to close, per the §13 audit ─────────────────────────────────────────

/** Distinct pipelines actually bound by an app. Reuse is about what is USED, not what exists. */
export function pipelinesReused(apps: readonly MetricApp[]): number {
  return new Set(apps.map((a) => a.pipelineId).filter((p): p is string => !!p)).size;
}

/** Apps that came from a template — "templates reused". */
export function appsFromTemplates(apps: readonly MetricApp[]): Ratio {
  return ratio(apps.filter((a) => !!a.templateId).length, apps.length);
}

/**
 * Apps per shared pipeline — the document's "number of applications using a common capability".
 *
 * Reported per pipeline rather than averaged: an average hides the case that matters, one pipeline
 * carrying twenty apps while ten others carry none.
 */
export function appsPerPipeline(apps: readonly MetricApp[]): { pipelineId: string; apps: number }[] {
  const counts = new Map<string, number>();
  for (const a of apps) {
    if (!a.pipelineId) continue;
    counts.set(a.pipelineId, (counts.get(a.pipelineId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([pipelineId, n]) => ({ pipelineId, apps: n }))
    .sort((x, y) => y.apps - x.apps);
}

// ─── Governance ────────────────────────────────────────────────────────────────────────────────────

/** Share of apps with evaluations — one of §13's three governance percentages. */
export function appsWithEvaluations(apps: readonly MetricApp[]): Ratio {
  return ratio(apps.filter((a) => a.hasEvaluations).length, apps.length);
}

/**
 * Share of AI activity that ran through a governed pipeline.
 *
 * The document asks for "percentage of AI activity routed through OGAC". Measured from inside OGAC, that
 * can only mean: of the runs we can see, how many were bound to a pipeline rather than running
 * unattached. Shadow AI outside the platform is by definition not countable here, and pretending
 * otherwise would be the overclaim this project keeps catching.
 */
export function governedActivityShare(runs: readonly MetricRun[]): Ratio {
  return ratio(runs.filter((r) => !!r.pipelineId).length, runs.length);
}

/** Share of runs that paused for a person — "consequential actions with required approval". */
export function humanApprovalShare(runs: readonly MetricRun[], approvedRunIds: ReadonlySet<string>): Ratio {
  const paused = runs.filter((r) => r.status === 'awaiting_human' || approvedRunIds.has(r.id));
  return ratio(paused.length, runs.length);
}

export interface ProductMetrics {
  reliability: {
    successful: number;
    failed: number;
    successRate: Ratio;
    blockedViolations: number;
    medianRunSeconds: number | null;
  };
  reuse: {
    pipelinesReused: number;
    fromTemplates: Ratio;
    appsPerPipeline: { pipelineId: string; apps: number }[];
  };
  governance: {
    appsWithEvaluations: Ratio;
    governedActivityShare: Ratio;
    humanApprovalShare: Ratio;
  };
}

/** Assemble every §13 metric that is derivable from recorded data. Pure; no I/O. */
export function assembleProductMetrics(
  runs: readonly MetricRun[],
  apps: readonly MetricApp[],
  events: readonly MetricAudit[],
  approvedRunIds: ReadonlySet<string> = new Set(),
): ProductMetrics {
  return {
    reliability: {
      successful: successfulRuns(runs),
      failed: failedRuns(runs),
      successRate: runSuccessRate(runs),
      blockedViolations: blockedViolations(events),
      medianRunSeconds: medianRunSeconds(runs),
    },
    reuse: {
      pipelinesReused: pipelinesReused(apps),
      fromTemplates: appsFromTemplates(apps),
      appsPerPipeline: appsPerPipeline(apps),
    },
    governance: {
      appsWithEvaluations: appsWithEvaluations(apps),
      governedActivityShare: governedActivityShare(runs),
      humanApprovalShare: humanApprovalShare(runs, approvedRunIds),
    },
  };
}
