import { randomUUID } from 'crypto';
import { searchDocuments } from '@/lib/brain';
import type { EvalDef } from '@/lib/eval-defs';
import {
  heuristicScore,
  rollupMetrics,
  scoreMetric,
  type MetricScore,
} from '@/lib/eval-metrics';
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
async function ragasMetrics(samples: Sample[]): Promise<Record<string, number> | null> {
  if (!RAGAS_URL) return null;
  try {
    const dataset = samples.map((s) => ({
      question: s.question,
      answer: s.answer,
      contexts: s.contexts,
      ground_truth: s.groundTruth,
    }));
    const res = await fetch(`${RAGAS_URL}/evaluate`, {
      method: 'POST',
      headers: await gatewayHeadersAsync({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model: EVAL_MODEL, gateway: `${GATEWAY_URL}/v1`, dataset }),
      signal: AbortSignal.timeout(180_000),
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

export interface EvalDefRunResult {
  run: EvalRun;
  metrics: MetricScore[];
  // The engine that actually computed the metric — 'ragas' when the sidecar answered, else
  // 'heuristic' (honest degradation).
  computedBy: EvalEngine | 'heuristic';
}

// Run one eval definition end-to-end and persist the scored run.
export async function runEvalDef(def: EvalDef): Promise<EvalDefRunResult> {
  const samples = await buildSamples();

  // Try ragas once for the whole dataset when the def uses it; else heuristic per-sample.
  const ragas = usesRagas(def) ? await ragasMetrics(samples) : null;
  const computedBy: EvalEngine | 'heuristic' =
    ragas && ragas[def.metric] !== undefined ? 'ragas' : 'heuristic';

  const perSample: MetricScore[] = [];
  const tpl = { metric: def.metric, direction: def.direction, defaultThreshold: def.threshold };

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
