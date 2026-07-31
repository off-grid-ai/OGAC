// ─── Evaluation score normalisation — pure ─────────────────────────────────────────────────────────
//
// LIVE FINDING. `eval_runs.score` is written on TWO different scales depending on which evaluator wrote
// it. Measured on the demo tenant:
//
//   golden                  avg 87.8    → 0–100
//   answer_relevancy:ragas  avg 80.0    → 0–100
//   faithfulness:grounding  avg  0.087  → 0–1
//   faithfulness:heuristic  avg  0
//
// The Quality page renders and AVERAGES them together, so "current mean 26.6%" mixes percentages with
// fractions and the "−6.1 pts" degradation verdict is computed across incompatible units. That is not a
// presentation problem: the release-gate decision reads the same numbers.
//
// The real fix is one scale at write time. Until every writer is corrected, normalising on READ makes the
// aggregate meaningful — and this module is the single place that rule lives, so it cannot drift between
// the chart, the mean and the gate.

/** A score as stored, plus the engine that wrote it (kept for future per-engine rules). */
export interface RawScore {
  score: number | null | undefined;
  engine?: string | null;
}

/**
 * Normalise one score to a 0–1 fraction, or null when it is unusable.
 *
 * The discriminator is the VALUE, not the engine name: a new evaluator can appear at any time and an
 * engine allow-list would silently mis-scale it. Anything above 1 can only be a percentage — no fraction
 * exceeds 1 — and anything at or below 1 is treated as a fraction. The ambiguous case is exactly 1, which
 * means "perfect" on both scales, so it needs no decision.
 *
 * Out-of-range values (negative, above 100, non-finite) return null rather than being clamped: a score of
 * 250 means the writer is wrong, and averaging a clamped 100% would hide that.
 */
export function normalizeScore(raw: RawScore | number | null | undefined): number | null {
  const v = typeof raw === 'number' ? raw : raw?.score;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < 0 || v > 100) return null;
  return v > 1 ? v / 100 : v;
}

/** Normalise to a whole percentage for display, or null when unusable. */
export function scorePercent(raw: RawScore | number | null | undefined): number | null {
  const f = normalizeScore(raw);
  return f === null ? null : Math.round(f * 100);
}

/**
 * Mean of a set of scores, on a 0–1 scale, ignoring unusable ones.
 *
 * Returns null for an empty or entirely-unusable set — never 0, which would read as "everything failed"
 * rather than "nothing was measured". Same rule as ratio() in product-metrics.ts.
 */
export function meanScore(raws: readonly (RawScore | number | null | undefined)[]): number | null {
  const usable = raws.map(normalizeScore).filter((n): n is number => n !== null);
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => a + b, 0) / usable.length;
}

/** True when a set mixes both storage scales — the condition that made the old mean meaningless. */
export function mixesScales(raws: readonly (RawScore | number | null | undefined)[]): boolean {
  let fraction = false;
  let percent = false;
  for (const r of raws) {
    const v = typeof r === 'number' ? r : r?.score;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (v > 1 && v <= 100) percent = true;
    else if (v > 0 && v < 1) fraction = true;
  }
  return fraction && percent;
}
