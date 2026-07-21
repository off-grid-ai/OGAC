// ─── PURE Ragas run summarization + engine attribution ──────────────────────────────────────────
//
// The Ragas sidecar (deploy/onprem/ragas-sidecar) scores a dataset and returns {metrics:{name:0..1}},
// OMITTING any metric it could not compute (honest degradation) — so a caller that reads only one
// key can't tell "the engine ran this metric" from "the engine silently dropped it". This module is
// the pure decision layer: given the metrics the console REQUESTED and the map the sidecar RETURNED
// (plus the governed judge routing that scored them), it computes the aggregate score and a full
// attribution record — which metrics came back, which were omitted, whether the target engine path
// is proven, and whether the run degraded. Zero I/O so it is unit-testable; the adapter feeds it the
// live sidecar response.

import type { JudgeRouting } from '@/lib/eval-judge';

/** The five canonical Ragas metrics the sidecar builds (matches app.py METRIC_ORDER). */
export const RAGAS_METRIC_SET = [
  'faithfulness',
  'answer_relevancy',
  'context_precision',
  'context_recall',
  'answer_correctness',
] as const;

export type RagasMetric = (typeof RAGAS_METRIC_SET)[number];

/** Retained, service-attributed record of one Ragas run — persisted on the eval_run row. */
export interface RagasAttribution {
  engine: 'ragas';
  /** The sidecar service identity (from its /health), e.g. 'ragas-sidecar'. */
  sidecarService: string;
  /** The pinned Ragas library version the sidecar runs (requirements.txt). */
  ragasVersion: string;
  /** The governed judge routing that scored the metrics (agent→pipeline→gateway→model). */
  judge: {
    model: string;
    agentId: string | null;
    pipelineId: string | null;
    gatewayId: string | null;
    conformant: boolean;
    attribution: string;
  };
  /** Metrics the console asked the sidecar to compute. */
  requested: RagasMetric[];
  /** Metrics the sidecar actually returned, with their 0..1 scores. */
  returned: Record<string, number>;
  /** Requested metrics the sidecar omitted (could not compute) — surfaced, never hidden. */
  omitted: RagasMetric[];
  /** true ⇒ the target 'faithfulness' metric came back as a real finite score (engine path proven). */
  engineProven: boolean;
  /** true ⇒ at least one requested metric was omitted (partial/degraded run). */
  degraded: boolean;
  note: string;
}

export interface RagasSummary {
  attribution: RagasAttribution;
  /** Aggregate 0..100 for the eval-run rollup. */
  score: number;
  /** The faithfulness metric (0..1) when present — the capability's headline number. */
  faithfulness?: number;
}

function isFinite01(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export interface RagasAttributionView {
  engine: string;
  sidecarService: string;
  ragasVersion: string;
  judgeModel: string;
  judgeConformant: boolean;
  judgeAttribution: string;
  agentId: string | null;
  pipelineId: string | null;
  gatewayId: string | null;
  /** Returned metrics as [name, 0..100] rows for display, in the canonical order. */
  metrics: Array<{ name: string; pct: number }>;
  omitted: string[];
  engineProven: boolean;
  degraded: boolean;
  note: string;
}

/**
 * Normalize a persisted attribution blob (jsonb → unknown) into a safe display shape. PURE. Reads
 * every field defensively so a legacy/foreign run row (no attribution, or a different engine's) can
 * never throw in the UI; unknown/missing fields degrade to empty rather than crashing the page.
 */
export function describeRagasAttribution(attr: Record<string, unknown> | null | undefined): RagasAttributionView | null {
  if (!attr || typeof attr !== 'object') return null;
  const judge = (attr.judge ?? {}) as Record<string, unknown>;
  const returned = (attr.returned ?? {}) as Record<string, unknown>;
  const metrics = RAGAS_METRIC_SET.filter((m) => isFinite01(returned[m])).map((m) => ({
    name: m,
    pct: Math.round((returned[m] as number) * 100),
  }));
  const omitted = Array.isArray(attr.omitted) ? attr.omitted.filter((x): x is string => typeof x === 'string') : [];
  const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
  return {
    engine: str(attr.engine, 'ragas'),
    sidecarService: str(attr.sidecarService, '—'),
    ragasVersion: str(attr.ragasVersion, '—'),
    judgeModel: str(judge.model, '—'),
    judgeConformant: judge.conformant === true,
    judgeAttribution: str(judge.attribution),
    agentId: typeof judge.agentId === 'string' ? judge.agentId : null,
    pipelineId: typeof judge.pipelineId === 'string' ? judge.pipelineId : null,
    gatewayId: typeof judge.gatewayId === 'string' ? judge.gatewayId : null,
    metrics,
    omitted,
    engineProven: attr.engineProven === true,
    degraded: attr.degraded === true,
    note: str(attr.note),
  };
}

/**
 * Aggregate a Ragas run into a 0..100 score. PURE. Prefers the returned metrics' mean (the real
 * engine signal); falls back to the retrieval pass-rate only when the sidecar returned nothing.
 */
export function ragasScore(returned: Record<string, number>, passed: number, total: number): number {
  const vals = Object.values(returned).filter(isFinite01);
  if (vals.length > 0) {
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100);
  }
  if (total > 0) return Math.round((passed / total) * 100);
  return 0;
}

/**
 * Build the full attribution + score for one Ragas run. PURE. `metrics` is the sidecar's raw
 * response map; anything requested but missing/non-finite is reported as omitted (degraded), and
 * `engineProven` is true only when faithfulness itself came back real — so the capability can be
 * marked proven on genuine engine output rather than a golden fallback.
 */
export function summarizeRagasRun(input: {
  requested: readonly RagasMetric[];
  metrics: Record<string, unknown>;
  judge: JudgeRouting;
  sidecarService: string;
  ragasVersion: string;
  passed: number;
  total: number;
}): RagasSummary {
  const { requested, metrics, judge, sidecarService, ragasVersion, passed, total } = input;
  const returned: Record<string, number> = {};
  for (const [k, v] of Object.entries(metrics)) {
    if (isFinite01(v)) returned[k] = v;
  }
  const omitted = requested.filter((m) => !isFinite01(metrics[m]));
  const engineProven = isFinite01(metrics.faithfulness);
  const degraded = omitted.length > 0;
  const note = engineProven
    ? degraded
      ? `Ragas produced faithfulness; ${omitted.length} of ${requested.length} requested metrics omitted.`
      : `Ragas produced all ${requested.length} requested metrics.`
    : 'Ragas returned no faithfulness score — engine path not proven for this run.';

  return {
    attribution: {
      engine: 'ragas',
      sidecarService,
      ragasVersion,
      judge: {
        model: judge.model,
        agentId: judge.agentId,
        pipelineId: judge.pipelineId,
        gatewayId: judge.gatewayId,
        conformant: judge.conformant,
        attribution: judge.attribution,
      },
      requested: [...requested],
      returned,
      omitted,
      engineProven,
      degraded,
      note,
    },
    score: ragasScore(returned, passed, total),
    faithfulness: isFinite01(metrics.faithfulness) ? metrics.faithfulness : undefined,
  };
}
