// PURE operator views for AI quality. This module owns the performance-window and release-gate
// portfolio projections; it has no database, network, or framework imports.

import { scorePercent } from '@/lib/eval-score-scale';

export type PerformanceStatus = 'insufficient' | 'stable' | 'warning' | 'degraded';

export interface QualityRunInput {
  id: string;
  score: number;
  startedAt: string;
  /**
   * Which evaluator produced this. Needed for two reasons, both of which were silently corrupting the
   * headline number:
   *
   * 1. SOME METRICS ARE LOWER-BETTER. `pii_leakage` scores 0 when NO PII leaked — a perfect result —
   *    and averaging that into a "quality" mean as 0% reported the best possible outcome as the worst.
   *    Six such runs on the live deployment were dragging the org's quality figure down.
   * 2. Mixing evaluators in one mean makes the number meaningless anyway; carrying the engine lets a
   *    caller see which ones are in the window.
   */
  engine?: string | null;
  /**
   * True when the engine ran but measured nothing. Such a run persists `score = 0`, which is
   * indistinguishable from "everything failed" — so it must be EXCLUDED from a mean, not averaged in.
   */
  degraded?: boolean;
}

/**
 * Metrics where a LOW score is the good outcome.
 *
 * Matched on the engine token rather than a hardcoded list of ids, so a new `*_leakage` or `*_toxicity`
 * evaluator is handled without another edit here. Being wrong in the safe direction matters: excluding a
 * metric that turns out to be higher-better loses one input, while INCLUDING a lower-better one inverts
 * the headline verdict.
 */
export function isLowerBetter(engine: string | null | undefined): boolean {
  return /leak|toxic|refus|violation|hallucinat|unsafe|bias/i.test(engine ?? '');
}

/**
 * Is this run usable as evidence of quality?
 *
 * Excludes a degraded run (nothing measured, persisted as 0), an unusable score, and any lower-better
 * metric — the last because this view aggregates into ONE "how good is the AI" number, and a metric
 * whose good direction is inverted cannot go into that average without corrupting it.
 */
export function countsTowardQuality(run: QualityRunInput): boolean {
  if (run.degraded) return false;
  if (isLowerBetter(run.engine)) return false;
  return scorePercent(run.score) !== null;
}

export interface QualityPerformanceView {
  status: PerformanceStatus;
  /**
   * Which evaluator the headline numbers describe, and how many others were set aside.
   *
   * Present because a single "quality %" across mixed evaluators is not a weaker version of the
   * measurement — it is not a measurement. Naming the evaluator is what makes the number defensible.
   */
  measuredBy?: string | null;
  setAsideEngines?: string[];
  latestScore: number | null;
  currentMean: number | null;
  baselineMean: number | null;
  delta: number | null;
  currentCount: number;
  baselineCount: number;
  trend: { label: string; score: number; runId: string }[];
}

/**
 * A score as a PERCENTAGE, whichever scale it was stored on.
 *
 * This used to clamp to 0..100 and treat every value as already a percentage — so an evaluator that
 * stores 0-1 (faithfulness:grounding writes 0.087) rendered as 0.1% instead of 8.7%, and the mean
 * averaged those fractions against golden's 87.8 as though the units matched. See eval-score-scale.ts
 * for the measured evidence.
 *
 * Unusable values collapse to 0 ONLY after countsTowardQuality has already removed them from the set;
 * they are never averaged. The `?? 0` here is a type convenience for the trend line, not a judgement.
 */
function finiteScore(value: number): number {
  return scorePercent(value) ?? 0;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function performanceStatus(delta: number): PerformanceStatus {
  if (delta <= -15) return 'degraded';
  if (delta <= -7) return 'warning';
  return 'stable';
}

export function buildQualityPerformance(runs: QualityRunInput[]): QualityPerformanceView {
  // Filtered BEFORE anything is averaged: a run that measured nothing persists `score = 0`
  // (indistinguishable from total failure), and a lower-better metric like pii_leakage scores 0 for a
  // PERFECT result. Both were being averaged into the headline.
  const usable = runs.filter(countsTowardQuality);

  // AND THEN GROUPED BY EVALUATOR, which is the part that actually matters. A mean across different
  // evaluators is not a weaker measurement, it is not a measurement: this deployment stores golden on
  // 0-97, ragas on 37-100 and faithfulness:grounding on 0-23, so mixing them produced a headline that
  // moved when the evaluator MIX changed and not when quality did. Removing only the direction and
  // degraded artefacts made the number worse, not better — measured on the live box — because the
  // scale mixing was the dominant term all along.
  const byEngine = new Map<string, QualityRunInput[]>();
  for (const run of usable) {
    const key = (run.engine ?? 'unattributed').trim() || 'unattributed';
    const bucket = byEngine.get(key);
    if (bucket) bucket.push(run);
    else byEngine.set(key, [run]);
  }

  // The evaluator with the most usable runs carries the headline; every other one is named as set
  // aside rather than silently folded in.
  const ranked = [...byEngine.entries()].sort((a, b) => b[1].length - a[1].length);
  const [primaryEngine, primaryRuns] = ranked[0] ?? [null, [] as QualityRunInput[]];
  const setAsideEngines = ranked.slice(1).map(([engine]) => engine);

  const normalized = primaryRuns
    .map((run) => ({ ...run, score: finiteScore(run.score) }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const trend = [...normalized].reverse().map((run, index) => ({
    label: `#${index + 1}`,
    score: Number(run.score.toFixed(1)),
    runId: run.id,
  }));

  if (normalized.length < 4) {
    return {
      status: 'insufficient',
      measuredBy: primaryEngine,
      setAsideEngines,
      latestScore: normalized[0] ? Number(normalized[0].score.toFixed(1)) : null,
      currentMean: normalized.length
        ? Number(mean(normalized.map((run) => run.score)).toFixed(1))
        : null,
      baselineMean: null,
      delta: null,
      currentCount: normalized.length,
      baselineCount: 0,
      trend,
    };
  }

  const windowSize = Math.min(10, Math.floor(normalized.length / 2));
  const current = normalized.slice(0, windowSize).map((run) => run.score);
  const baseline = normalized.slice(windowSize, windowSize * 2).map((run) => run.score);
  const currentMean = Number(mean(current).toFixed(1));
  const baselineMean = Number(mean(baseline).toFixed(1));
  const delta = Number((currentMean - baselineMean).toFixed(1));
  return {
    status: performanceStatus(delta),
    measuredBy: primaryEngine,
    setAsideEngines,
    latestScore: Number(normalized[0].score.toFixed(1)),
    currentMean,
    baselineMean,
    delta,
    currentCount: current.length,
    baselineCount: baseline.length,
    trend,
  };
}

export type GatePortfolioStatus =
  'ungated' | 'not-run' | 'running' | 'passed' | 'blocked' | 'overridden';

export interface GatePipelineInput {
  id: string;
  name: string;
  status: string;
}

export interface GateDefinitionInput {
  id: string;
  pipelineId: string | null;
}

export interface GateJobInput {
  jobId: string;
  pipelineId: string;
  status: 'gating' | 'published' | 'blocked';
  createdAt: string | null;
  overridden: boolean;
  summary: string | null;
}

export interface GatePortfolioRow {
  pipelineId: string;
  pipelineName: string;
  pipelineStatus: string;
  attachedEvals: number;
  status: GatePortfolioStatus;
  lastCheckedAt: string | null;
  summary: string;
}

export function buildReleaseGatePortfolio(
  pipelines: GatePipelineInput[],
  definitions: GateDefinitionInput[],
  jobs: GateJobInput[],
): GatePortfolioRow[] {
  const definitionCount = new Map<string, number>();
  for (const definition of definitions) {
    if (!definition.pipelineId) continue;
    definitionCount.set(
      definition.pipelineId,
      (definitionCount.get(definition.pipelineId) ?? 0) + 1,
    );
  }

  const latestJob = new Map<string, GateJobInput>();
  for (const job of jobs) {
    const current = latestJob.get(job.pipelineId);
    if (!current || (job.createdAt ?? '') > (current.createdAt ?? '')) {
      latestJob.set(job.pipelineId, job);
    }
  }

  return pipelines
    .map((pipeline) => {
      const attachedEvals = definitionCount.get(pipeline.id) ?? 0;
      const job = latestJob.get(pipeline.id);
      if (attachedEvals === 0) {
        return {
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          pipelineStatus: pipeline.status,
          attachedEvals,
          status: 'ungated' as const,
          lastCheckedAt: job?.createdAt ?? null,
          summary: 'No evaluator is attached. Releases are allowed without a quality verdict.',
        };
      }
      if (!job) {
        return {
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          pipelineStatus: pipeline.status,
          attachedEvals,
          status: 'not-run' as const,
          lastCheckedAt: null,
          summary:
            'The gate has not run yet. Publish from the pipeline Quality view to evaluate it.',
        };
      }
      let status: GatePortfolioStatus;
      if (job.status === 'gating') status = 'running';
      else if (job.status === 'blocked') status = 'blocked';
      else if (job.overridden) status = 'overridden';
      else status = 'passed';
      return {
        pipelineId: pipeline.id,
        pipelineName: pipeline.name,
        pipelineStatus: pipeline.status,
        attachedEvals,
        status,
        lastCheckedAt: job.createdAt,
        summary:
          job.summary ??
          (status === 'running'
            ? 'Attached evaluators are running.'
            : 'The persisted gate job has no decision summary.'),
      };
    })
    .sort((a, b) => a.pipelineName.localeCompare(b.pipelineName));
}
