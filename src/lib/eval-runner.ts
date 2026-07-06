import { randomUUID } from 'crypto';
import { searchDocuments } from '@/lib/brain';
import type { EvalDef } from '@/lib/eval-defs';
import {
  heuristicScore,
  rollupMetrics,
  scoreMetric,
  type MetricScore,
} from '@/lib/eval-metrics';
import {
  buildGEvalPrompt,
  gEvalUnavailable,
  parseGEvalScore,
  type GEvalResult,
} from '@/lib/eval-geval';
import type { EvalEngine } from '@/lib/eval-templates';
import { listGoldenCases, recordEvalRun, type EvalRun } from '@/lib/evals';
import { GATEWAY_URL, gatewayHeadersAsync } from '@/lib/gateway';

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

const EVAL_MODEL = process.env.OFFGRID_EVAL_MODEL ?? 'gemma-local';
const RAGAS_URL = process.env.OFFGRID_RAGAS_URL;

interface Sample {
  question: string;
  answer: string;
  contexts: string[];
  groundTruth: string;
}

async function generateAnswer(question: string, contexts: string[]): Promise<string> {
  const ctx = contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n');
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: await gatewayHeadersAsync({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      model: EVAL_MODEL,
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

async function buildSamples(): Promise<Sample[]> {
  const cases = await listGoldenCases();
  const samples: Sample[] = [];
  for (const c of cases) {
    const hits = await searchDocuments(c.query, 3);
    const contexts = hits.map((h) => h.text);
    let answer = '';
    try {
      answer = await generateAnswer(c.query, contexts);
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
  metrics?: string[],
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
        model: EVAL_MODEL,
        gateway: `${GATEWAY_URL}/v1`,
        dataset,
        ...(metrics && metrics.length ? { metrics } : {}),
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
async function gEvalJudge(criteria: string, s: Sample): Promise<GEvalResult> {
  if (!gatewayJudgeConfigured()) {
    return gEvalUnavailable('No gateway judge configured (set OFFGRID_GATEWAY_URL) — G-Eval needs one.');
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
        model: EVAL_MODEL,
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
export async function runEvalDef(def: EvalDef): Promise<EvalDefRunResult> {
  const samples = await buildSamples();
  const tpl = { metric: def.metric, direction: def.direction, defaultThreshold: def.threshold };
  const perSample: MetricScore[] = [];

  // ── G-Eval (custom LLM-as-judge over the operator's plain-English criteria) ──────────────────────
  // Judge-only: there is no honest heuristic for arbitrary criteria. If no gateway judge is
  // configured (or every judge call fails), we record NOTHING and surface the reason — never a
  // fabricated score. The criteria is the def's description (what the operator wrote when applying).
  if (def.metric === 'g_eval') {
    const criteria = def.description || def.name;
    let anyParsed = false;
    let reason = '';
    for (const s of samples) {
      const r = await gEvalJudge(criteria, s);
      if (r.parsed) {
        anyParsed = true;
        perSample.push(scoreMetric(tpl, r.score, 'deepeval', def.threshold));
      } else {
        reason = r.rationale || reason;
      }
    }
    if (!anyParsed) {
      // Honest unavailable: persist a 0/0 run tagged unavailable so the surface shows it ran but
      // could not score, with the reason — not a fake pass/fail.
      const id = `ed_run_${randomUUID().slice(0, 6)}`;
      const engineTag = `${def.metric}:unavailable`;
      await recordEvalRun({ id, engine: engineTag, score: 0, total: 0, passed: 0 });
      return {
        run: { id, engine: engineTag, score: 0, total: 0, passed: 0, startedAt: new Date().toISOString() },
        metrics: [],
        computedBy: 'unavailable',
        unavailableReason: reason || 'G-Eval judge unavailable — no score recorded.',
      };
    }
    return persistRun(def, perSample, 'deepeval');
  }

  // ── ragas (real sidecar) or first-party heuristic for everything else ────────────────────────────
  const ragas = usesRagas(def) ? await ragasMetrics(samples, [def.metric]) : null;
  const computedBy: EvalEngine | 'heuristic' =
    ragas && ragas[def.metric] !== undefined ? 'ragas' : 'heuristic';

  if (computedBy === 'ragas' && ragas) {
    // Ragas returns dataset-level aggregate per metric — score the whole run once against it.
    const value = ragas[def.metric] ?? 0;
    perSample.push(scoreMetric(tpl, value, 'ragas', def.threshold));
  } else {
    for (const s of samples) {
      const value = heuristicScore(def.metric, {
        question: s.question,
        answer: s.answer,
        contexts: s.contexts,
        groundTruth: s.groundTruth,
        source: s.contexts.join(' '),
      });
      perSample.push(scoreMetric(tpl, value, 'heuristic', def.threshold));
    }
  }

  return persistRun(def, perSample, computedBy);
}

// Roll up + persist a scored run, tagged with the engine that actually computed it. Shared by the
// G-Eval and ragas/heuristic paths so the persistence shape stays identical.
async function persistRun(
  def: EvalDef,
  perSample: MetricScore[],
  computedBy: EvalEngine | 'heuristic',
): Promise<EvalDefRunResult> {
  const rollup = rollupMetrics(perSample);
  const id = `ed_run_${randomUUID().slice(0, 6)}`;
  const engineTag = `${def.metric}:${computedBy}`;
  await recordEvalRun({
    id,
    engine: engineTag,
    score: rollup.score,
    total: rollup.total,
    passed: rollup.passed,
  });
  const run: EvalRun = {
    id,
    engine: engineTag,
    score: rollup.score,
    total: rollup.total,
    passed: rollup.passed,
    startedAt: new Date().toISOString(),
  };
  return { run, metrics: perSample, computedBy };
}
