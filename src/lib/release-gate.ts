// PURE release-gate decision — ZERO imports of db/IO, exhaustively unit-testable (mirrors
// pipelines-policy.ts / eval-metrics.ts). M1 "close the loop": a pipeline version only goes
// PUBLISHED if it clears its attached evals against their thresholds. This file owns the DECISION;
// the I/O (run the pipeline's evals, then block/allow the publish) lives in pipelines.ts.
//
// A gate result is one of:
//   • pass=true  — every attached eval scored at-or-above its threshold (or there were no evals to
//     gate on: a pipeline with no evals is NOT blocked — additive/safe, existing publish keeps
//     working). `gated` says whether any eval actually contributed a verdict.
//   • pass=false — one or more evals scored below threshold; `failing[]` names them with the score
//     that failed, so the surface + the audit trail can say exactly WHY publish was blocked.
//
// The gate NEVER fabricates a pass: an eval that could not score (engine unavailable, 0/0 run) is
// carried as `unscored` — it does not count as a pass and does not, on its own, fail the gate
// (there's no honest verdict to fail on). If EVERY eval is unscored the gate is honestly ungated
// (pass=true, gated=false) — we never block a release on a verdict we couldn't compute, nor fake one.

// One eval's contribution to the gate. `score` is the run's 0..100 pass-rate; `thresholdPct` is the
// eval definition's 0..1 threshold expressed on the same 0..100 scale so the comparison is apples to
// apples with the score the eval-runner persists. `scored=false` ⇒ the run could not compute a
// verdict (e.g. a judge-only metric with no judge configured) — carried honestly, never a fake pass.
export interface GateEvalResult {
  evalId: string;
  name: string;
  /** The run's rolled-up score on a 0..100 scale (share of metric verdicts that passed). */
  score: number;
  /** The eval definition's threshold on a 0..100 scale (its 0..1 threshold × 100). */
  thresholdPct: number;
  /** False when the run could not score (unavailable engine / 0/0 run) — no honest verdict. */
  scored: boolean;
}

export interface GateFailure {
  evalId: string;
  name: string;
  score: number;
  thresholdPct: number;
}

export interface ReleaseGateDecision {
  /** True ⇒ safe to publish. False ⇒ block (or publish-with-override + audit). */
  pass: boolean;
  /** True when at least one eval produced a real verdict that the gate is standing on. */
  gated: boolean;
  /** The evals that scored BELOW their threshold — the honest reason a failing gate blocks. */
  failing: GateFailure[];
  /** The evals that could not score (carried honestly; neither pass nor fail). */
  unscored: { evalId: string; name: string }[];
  /** Count of evals that passed their threshold. */
  passed: number;
  /** A one-line, operator-facing summary of the verdict. */
  summary: string;
}

/** An eval definition as the gate sees it (only the fields the decision needs). PURE input. */
export interface GateEvalDef {
  id: string;
  name: string;
  threshold: number; // 0..1
}

/**
 * Decide whether a pipeline may publish, given its attached eval definitions and the results of
 * running them. PURE — no I/O. The caller (pipelines.publishPipeline) runs the evals and supplies
 * the results; this decides pass/fail and names the failures.
 *
 * Rules:
 *  - No attached evals ⇒ pass, ungated (additive/safe — a pipeline with no quality bar still ships).
 *  - Each scored eval passes when its run score ≥ its threshold (both on the 0..100 scale).
 *  - An unscored eval (engine couldn't compute) is carried honestly and does NOT fail the gate.
 *  - The gate FAILS iff at least one eval scored strictly below its threshold.
 *  - `gated` is true iff at least one eval produced a real (scored) verdict.
 */
export function evaluateReleaseGate(
  evalDefs: GateEvalDef[],
  results: GateEvalResult[],
): ReleaseGateDecision {
  if (evalDefs.length === 0) {
    return {
      pass: true,
      gated: false,
      failing: [],
      unscored: [],
      passed: 0,
      summary: 'No evals attached — nothing to gate on. Publish allowed.',
    };
  }

  const byId = new Map(results.map((r) => [r.evalId, r]));
  const failing: GateFailure[] = [];
  const unscored: { evalId: string; name: string }[] = [];
  let passed = 0;
  let gated = false;

  for (const def of evalDefs) {
    const r = byId.get(def.id);
    if (!r || !r.scored) {
      unscored.push({ evalId: def.id, name: def.name });
      continue;
    }
    gated = true;
    if (r.score < r.thresholdPct) {
      failing.push({
        evalId: def.id,
        name: def.name,
        score: r.score,
        thresholdPct: r.thresholdPct,
      });
    } else {
      passed += 1;
    }
  }

  const pass = failing.length === 0;
  const summary = !gated
    ? 'No eval produced a verdict (engines unavailable) — publish not blocked, but not gated.'
    : pass
      ? `Gate passed — ${passed} eval(s) at or above threshold.`
      : `Gate failed — ${failing.length} eval(s) below threshold: ${failing
          .map((f) => `${f.name} (${f.score}% < ${f.thresholdPct}%)`)
          .join(', ')}.`;

  return { pass, gated, failing, unscored, passed, summary };
}

/** Convert an eval definition's 0..1 threshold to the 0..100 scale the run score uses. PURE. */
export function thresholdToPct(threshold: number): number {
  const t = Number.isFinite(threshold) ? threshold : 0;
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}
