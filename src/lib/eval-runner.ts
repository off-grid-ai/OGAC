import { randomUUID } from 'node:crypto';
import { searchDocuments } from '@/lib/brain';
import type { EvalDef } from '@/lib/eval-defs';
import {
  buildGEvalPrompt,
  gEvalUnavailable,
  parseGEvalScore,
  type GEvalResult,
} from '@/lib/eval-geval';
import { loadJudgeRouting } from '@/lib/eval-judge-resolve';
import { heuristicScore, metricsToEvalResults, rollupMetrics, scoreMetric, type MetricScore } from '@/lib/eval-metrics';
import { capEvalSamples } from '@/lib/eval-sampling';
import type { EvalEngine } from '@/lib/eval-templates';
import { listGoldenCases, recordEvalRun, type EvalRun } from '@/lib/evals';
import { GATEWAY_URL, gatewayHeadersAsync } from '@/lib/gateway';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// EVAL-DEFINITION RUNNER (I/O layer). Given a saved eval definition, it:
//   1. builds a RAG sample per golden case (Brain for contexts, gateway for a grounded answer,
//      the golden `expected` as ground-truth) — the same dataset shape the ragas adapter uses;
//   2. scores the definition's metric with its ENGINE:
//        - ragas → the ragas sidecar's per-metric score when OFFGRID_RAGAS_URL is set;
//        - everything else (and ragas-without-sidecar) → the first-party heuristic scorer;
//   3. thresholds each sample into a pass/fail verdict (pure eval-metrics logic) and rolls them up;
//   4. persists the run through recordEvalRun so it lands in the existing pass-rate rollup, tagged
//      with the engine that ACTUALLY computed the score (honest: 'ragas' vs 'heuristic').
// No fabricated scores: if an external engine isn't configured we say so by tagging 'heuristic'.

const RAGAS_URL = process.env.OFFGRID_RAGAS_URL;

interface Sample {
  question: string;
  answer: string;
  contexts: string[];
  groundTruth: string;
}

async function generateAnswer(
  question: string,
  contexts: string[],
  model: string,
): Promise<string> {
  const ctx = contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n');
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: await gatewayHeadersAsync({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Answer only from the provided context. Be concise.' },
        { role: 'user', content: `CONTEXT:\n${ctx}\n\nQUESTION: ${question}` },
      ],
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error('gateway answer generation failed');
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}

async function buildSamples(model: string): Promise<Sample[]> {
  const cases = capEvalSamples(await listGoldenCases());
  const samples: Sample[] = [];
  for (const c of cases) {
    const hits = await searchDocuments(c.query, 3);
    const contexts = hits.map((h) => h.text);
    let answer = '';
    try {
      answer = await generateAnswer(c.query, contexts, model);
    } catch {
      // Gateway unreachable — fall back to the expected text so the heuristic still scores something
      // rather than crashing the whole run. The score is honestly low; never fabricated high.
      answer = '';
    }
    samples.push({ question: c.query, answer, contexts, groundTruth: c.expected });
  }
  return samples;
}

// Ask the ragas sidecar for per-metric scores over the dataset. Returns the metric map (0..1) or
// null if the sidecar is unset/unreachable — the caller then degrades to the heuristic honestly.
async function ragasMetrics(
  samples: Sample[],
  metrics: string[] | undefined,
  model: string,
): Promise<Record<string, number> | null> {
  if (!RAGAS_URL) return null;
  try {
    const dataset = samples.map((s) => ({
      question: s.question,
      answer: s.answer,
      contexts: s.contexts,
      ground_truth: s.groundTruth,
    }));
    // Only ask ragas for the metric(s) this eval actually needs — each metric is a chain of gateway
    // LLM calls (~30–90s on local hardware), so running all 5 blows past the timeout and the caller
    // falls back to the heuristic. Scoping to the requested metric keeps a real ragas run in budget.
    const res = await fetch(`${RAGAS_URL}/evaluate`, {
      method: 'POST',
      headers: await gatewayHeadersAsync({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model,
        gateway: `${GATEWAY_URL}/v1`,
        dataset,
        ...(metrics?.length ? { metrics } : {}),
      }),
      signal: AbortSignal.timeout(600_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { metrics?: Record<string, number> };
    return data.metrics ?? null;
  } catch {
    return null;
  }
}

const RAGAS_METRICS = new Set([
  'faithfulness',
  'answer_relevancy',
  'context_precision',
  'context_recall',
  'answer_correctness',
]);

// Whether this definition's metric can be scored by the real ragas sidecar.
function usesRagas(def: EvalDef): boolean {
  return def.engine === 'ragas' && RAGAS_METRICS.has(def.metric);
}

// Is a gateway judge configured? The gateway URL always has a localhost default, so "configured"
// means the operator explicitly set OFFGRID_GATEWAY_URL. Without it, G-Eval can't run honestly.
function gatewayJudgeConfigured(): boolean {
  return Boolean(process.env.OFFGRID_GATEWAY_URL);
}

// G-EVAL judge (I/O): send the operator's plain-English criteria + one sample to the gateway as an
// LLM-as-judge, parse a 1..5 verdict back to 0..1. NEVER fabricates: on no-gateway/failure/unparseable
// text it returns a `parsed:false` result so the caller records no score and surfaces the reason.
async function gEvalJudge(criteria: string, s: Sample, model: string): Promise<GEvalResult> {
  if (!gatewayJudgeConfigured()) {
    return gEvalUnavailable(
      'No gateway judge configured (set OFFGRID_GATEWAY_URL) — G-Eval needs one.',
    );
  }
  const prompt = buildGEvalPrompt(criteria, {
    question: s.question,
    answer: s.answer,
    contexts: s.contexts,
    groundTruth: s.groundTruth,
  });
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: await gatewayHeadersAsync({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return gEvalUnavailable('Gateway judge returned an error — no score recorded.');
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return parseGEvalScore(data.choices?.[0]?.message?.content ?? '');
  } catch {
    return gEvalUnavailable('Gateway judge unreachable — no score recorded.');
  }
}

export interface EvalDefRunResult {
  run: EvalRun;
  metrics: MetricScore[];
  // The engine that actually computed the metric — 'ragas' when the sidecar answered, 'deepeval' when
  // the gateway judge scored G-Eval, 'unavailable' when a judge-only metric couldn't run (honest — no
  // fabricated score), else 'heuristic' (honest first-party degradation).
  computedBy: EvalEngine | 'heuristic' | 'unavailable';
  // For judge-only metrics that couldn't run: the honest reason (surfaced in the UI). Undefined otherwise.
  unavailableReason?: string;
}

// Run one eval definition end-to-end and persist the scored run.
export async function runEvalDef(
  def: EvalDef,
  orgId: string = DEFAULT_ORG,
): Promise<EvalDefRunResult> {
  // GOVERNING INVARIANT: the judge is a system agent on a pipeline — resolve its model through
  // agent→pipeline→gateway, never a pinned env model. Both answer-generation and the judge use it.
  const judge = await loadJudgeRouting(orgId);
  // eslint-disable-next-line no-console
  console.log(`[eval] ${def.metric} via ${judge.attribution}`);
  const samples = await buildSamples(judge.model);
  const tpl = { metric: def.metric, direction: def.direction, defaultThreshold: def.threshold };
  const perSample: MetricScore[] = [];

  // ── G-Eval (custom LLM-as-judge over the operator's plain-English criteria) ──────────────────────
  // Judge-only: there is no honest heuristic for arbitrary criteria. If no gateway judge is
  // configured (or every judge call fails), we record NOTHING and surface the reason — never a
  // fabricated score. The criteria is the def's description (what the operator wrote when applying).
  if (def.metric === 'g_eval') return runGEval(def, samples, tpl, judge.model, orgId);

  // ── ragas (real sidecar) or first-party heuristic for everything else ────────────────────────────
  const ragas = usesRagas(def) ? await ragasMetrics(samples, [def.metric], judge.model) : null;
  const aggregate = ragas?.[def.metric];
  // Ragas returns ONE dataset-level aggregate per metric; the heuristic scores every sample. Which
  // engine actually produced the number is recorded on the run, never assumed from which was asked.
  // ── THE FALLBACK LADDER: ragas → entailment → heuristic ─────────────────────────────────────────
  //
  // It used to be ragas → heuristic, and the missing middle rung made every faithfulness run score 0. The
  // degradation was honestly TAGGED (`faithfulness:heuristic`), so nothing was fabricated — but a gate that
  // always fails is as useless as one that always passes, and worse, because it teaches people to ignore a
  // real one. It would have made all 11 apps look broken on their most important metric.
  //
  // GROUNDING IS FAITHFULNESS. The entailment adapter behind /api/v1/admin/grounding/verify scores a
  // paraphrase as supported and refuses a contradiction (verified live 2026-07-30), so for these two metrics
  // it is a far better second rung than a lexical overlap score. Best-effort: if it is unreachable we still
  // fall through to the heuristic, and whichever rung produced the number is what gets recorded.
  const entailment =
    aggregate === undefined && /^(faithfulness|groundedness)$/i.test(def.metric)
      ? await entailmentScores(samples)
      : null;
  const computedBy: EvalEngine | 'heuristic' =
    aggregate !== undefined ? 'ragas' : entailment ? ('grounding' as EvalEngine) : 'heuristic';
  const scored =
    aggregate !== undefined
      ? [scoreMetric(tpl, aggregate, 'ragas', def.threshold)]
      : entailment
        ? entailment.map((value) => scoreMetric(tpl, value, 'grounding', def.threshold))
        : samples.map((sample) =>
            scoreMetric(tpl, heuristicSampleScore(def.metric, sample), 'heuristic', def.threshold),
          );

  return persistRun(def, [...perSample, ...scored], computedBy, orgId);
}

/**
 * Per-sample entailment scores from the grounding port — the ladder's middle rung.
 *
 * Returns null (not zeros) when the port is unconfigured, unreachable, or returns nothing usable, so the
 * caller degrades to the heuristic rather than recording a fabricated 0. A null here means "this rung could
 * not answer", which is a different fact from "the answer was unfaithful".
 */
async function entailmentScores(
  samples: readonly { answer: string; contexts: string[] }[],
): Promise<number[] | null> {
  try {
    const { getGrounding } = await import('@/lib/adapters/registry');
    const port = getGrounding();
    const out: number[] = [];
    for (const s of samples) {
      const sources = s.contexts.filter((c) => c.trim()).map((text) => ({ text }));
      if (sources.length === 0 || !s.answer.trim()) return null;
      const r = await port.verify(s.answer, sources);
      if (typeof r?.score !== 'number') return null;
      out.push(r.score / 100); // the port reports 0–100; metric thresholds are 0–1
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Score one golden sample offline, mapping the sample shape onto the heuristic's inputs. */
function heuristicSampleScore(
  metric: string,
  sample: { question: string; answer: string; contexts: string[]; groundTruth?: string },
): number {
  return heuristicScore(metric, {
    question: sample.question,
    answer: sample.answer,
    contexts: sample.contexts,
    groundTruth: sample.groundTruth,
    source: sample.contexts.join(' '),
  });
}

/**
 * G-Eval: a custom LLM-as-judge over the operator's own plain-English criteria.
 *
 * Judge-ONLY by design — there is no honest heuristic for arbitrary criteria, so if no judge is
 * configured or every call fails we record a 0/0 run tagged `unavailable` WITH the reason, rather
 * than a fabricated pass or fail. An eval surface that invents a score when it could not measure is
 * worse than one that admits it did not run.
 */
async function runGEval(
  def: EvalDef,
  samples: Awaited<ReturnType<typeof buildSamples>>,
  tpl: { metric: string; direction: EvalDef['direction']; defaultThreshold: number },
  judgeModel: string,
  orgId: string,
): Promise<EvalDefRunResult> {
  const criteria = def.description || def.name;
  const perSample: MetricScore[] = [];
  let reason = '';

  for (const sample of samples) {
    const r = await gEvalJudge(criteria, sample, judgeModel);
    if (r.parsed) perSample.push(scoreMetric(tpl, r.score, 'deepeval', def.threshold));
    else reason = r.rationale || reason;
  }

  if (perSample.length > 0) return persistRun(def, perSample, 'deepeval', orgId);
  return unavailableRun(def, reason, orgId);
}

/** Persist an honest "it ran but could not score" result, with the reason. */
async function unavailableRun(
  def: EvalDef,
  reason: string,
  orgId: string,
): Promise<EvalDefRunResult> {
  const id = `ed_run_${randomUUID().slice(0, 6)}`;
  const engineTag = `${def.metric}:unavailable`;
  // PA-12: tag the run with the eval def's pipeline binding so Drift is per-pipeline exact.
  await recordEvalRun(
    { id, engine: engineTag, score: 0, total: 0, passed: 0, pipelineId: def.pipelineId },
    orgId,
  );
  return {
    run: {
      id,
      engine: engineTag,
      score: 0,
      total: 0,
      passed: 0,
      startedAt: new Date().toISOString(),
      pipelineId: def.pipelineId,
    },
    metrics: [],
    computedBy: 'unavailable',
    unavailableReason: reason || 'G-Eval judge unavailable — no score recorded.',
  };
}

// Roll up + persist a scored run, tagged with the engine that actually computed it. Shared by the
// G-Eval and ragas/heuristic paths so the persistence shape stays identical.
async function persistRun(
  def: EvalDef,
  perSample: MetricScore[],
  computedBy: EvalEngine | 'heuristic',
  orgId: string = DEFAULT_ORG,
): Promise<EvalDefRunResult> {
  const rollup = rollupMetrics(perSample);
  const id = `ed_run_${randomUUID().slice(0, 6)}`;
  const engineTag = `${def.metric}:${computedBy}`;
  // PA-12: tag the persisted run with the eval def's pipeline binding (null for a library eval) so
  // per-pipeline Drift reads exactly this pipeline's eval-score history.
  await recordEvalRun(
    {
      id,
      engine: engineTag,
      score: rollup.score,
      total: rollup.total,
      passed: rollup.passed,
      // RETAIN THE EVIDENCE. This function already has the per-sample metrics — it rolls them up to
      // compute the score above — and used to drop them, so 64 of 84 stored runs carried a number with
      // nothing behind it. A failing run that cannot say WHAT failed is not an audit record, and
      // "every important action must leave an understandable record" is a stated non-negotiable.
      results: metricsToEvalResults(perSample),
      pipelineId: def.pipelineId,
    },
    orgId,
  );
  const run: EvalRun = {
    id,
    engine: engineTag,
    score: rollup.score,
    total: rollup.total,
    passed: rollup.passed,
    startedAt: new Date().toISOString(),
    pipelineId: def.pipelineId,
  };
  return { run, metrics: perSample, computedBy };
}
