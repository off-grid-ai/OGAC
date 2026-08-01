// ─── Turning an engine's own output into per-row eval EVIDENCE — PURE ──────────────────────────────
//
// ROADMAP §11: "Full observability — no invisible behavior. Every important action must leave an
// understandable record", and §10 Flow 7: the operator sees the "evaluation stages". A run row that
// carries a score and nothing else fails both — the Quality surface showed pass rates nobody could
// drill into, and the newest failing ragas run recorded nothing about WHAT failed.
//
// The engines do not agree on what a "case" is, which is why this was never uniform:
//   • golden / eval-defs → one row per GOLDEN CASE (query, expected, what came back, pass/fail)
//   • ragas              → one row per METRIC over the whole dataset (faithfulness 0.37, …); there is
//                          no per-case score to record, and inventing one would be a lie
//   • promptfoo          → one row per assertion, from its own JSON summary
//   • unavailable        → no cases at all, but a REASON, which is itself the evidence
//
// So this maps each engine's real output onto the shared EvalResult row, and — where an engine
// genuinely has no per-case data — says so in a row rather than leaving the drill-down empty. An empty
// list must mean "we did not record it", never "there was nothing to record".

import type { EvalResult } from '@/lib/evals';

/** A ragas-style metric map: metric name → score in 0..1, with omitted metrics simply absent. */
export function ragasEvidence(
  requested: readonly string[],
  returned: Record<string, number>,
  threshold = 0.7,
): EvalResult[] {
  return requested.map((metric) => {
    const value = returned[metric];
    const scored = typeof value === 'number' && Number.isFinite(value);
    return {
      query: metric,
      // What the metric is measured against, in the operator's terms — the threshold is the contract.
      expected: `≥ ${threshold.toFixed(2)}`,
      pass: scored ? value >= threshold : false,
      // An omitted metric is NOT a zero. Say which it is: a scored 0.00 and an unreturned metric are
      // different facts and a rollup that conflates them misleads a release gate.
      top: scored ? value.toFixed(3) : 'not returned by the engine',
      score: scored ? value : 0,
    };
  });
}

/** A promptfoo summary's per-assertion rows, when it produced any. */
export interface PromptfooCase {
  vars?: { query?: string };
  success?: boolean;
  response?: { output?: string };
  gradingResult?: { reason?: string };
}

export function promptfooEvidence(cases: PromptfooCase[] | undefined): EvalResult[] {
  return (cases ?? []).map((c) => ({
    query: c.vars?.query ?? '(no query recorded)',
    expected: c.gradingResult?.reason ?? 'assertion',
    pass: Boolean(c.success),
    top: (c.response?.output ?? '').slice(0, 400),
    score: c.success ? 1 : 0,
  }));
}

/**
 * The row that stands in for "this run could not be scored, and here is why". A run with zero cases and
 * zero rows is indistinguishable from a run nobody looked at; this makes the reason part of the record.
 */
export function unavailableEvidence(reason: string): EvalResult[] {
  return [
    {
      query: 'Evaluation did not run',
      expected: 'a score from the configured engine',
      pass: false,
      top: reason,
      score: 0,
    },
  ];
}

/**
 * Whether a stored run can be drilled into. Used by the Quality surface to tell "no evidence retained"
 * (a defect in the writer) apart from "nothing to show" (an honest empty run).
 */
export function hasEvidence(results: EvalResult[] | undefined | null): boolean {
  return Array.isArray(results) && results.length > 0;
}
