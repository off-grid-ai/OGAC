// ─── PURE eval sample-set bounding ───────────────────────────────────────────────────────────────
//
// Each Ragas metric over one sample is a chain of gateway LLM-judge calls (~seconds each on local
// hardware), so scoring an unbounded golden set (dozens+ of cases × several metrics) overwhelms a
// single-box fleet and blows past the client timeout — the run then silently falls back to the
// heuristic. Evals in practice score a representative SAMPLE, not the entire corpus. This bounds the
// sample set to a configurable cap (OFFGRID_EVAL_SAMPLE_LIMIT, default 6) so a real sidecar-backed
// run stays inside budget. Pure + unit-testable; the runners call capEvalSamples on the golden list.

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 200;

/** Resolve the eval sample cap from env: a positive integer, default 6, hard-ceilinged at 200. */
export function evalSampleLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number((env.OFFGRID_EVAL_SAMPLE_LIMIT ?? '').trim());
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(raw), MAX_LIMIT);
}

/** Take the first `limit` (resolved from env when omitted) items — the bounded eval sample set. */
export function capEvalSamples<T>(cases: readonly T[], limit = evalSampleLimit()): T[] {
  return cases.slice(0, Math.max(1, limit));
}
