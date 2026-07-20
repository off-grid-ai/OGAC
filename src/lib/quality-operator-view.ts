// PURE operator views for AI quality. This module owns the performance-window and release-gate
// portfolio projections; it has no database, network, or framework imports.

export type PerformanceStatus = 'insufficient' | 'stable' | 'warning' | 'degraded';

export interface QualityRunInput {
  id: string;
  score: number;
  startedAt: string;
}

export interface QualityPerformanceView {
  status: PerformanceStatus;
  latestScore: number | null;
  currentMean: number | null;
  baselineMean: number | null;
  delta: number | null;
  currentCount: number;
  baselineCount: number;
  trend: { label: string; score: number; runId: string }[];
}

function finiteScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
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
  const normalized = runs
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
  | 'ungated'
  | 'not-run'
  | 'running'
  | 'passed'
  | 'blocked'
  | 'overridden';

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
          summary: 'The gate has not run yet. Publish from the pipeline Quality view to evaluate it.',
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

