// ─── Quality on REAL cases, not just test cases ──────────────────────────────────────────────────────
//
// The platform judges every finished run out of band (app-run-store fires scoreAppRun, and the verdict
// lands in online_scores). Nothing surfaced it on the app that produced it — so an app's Quality tab
// showed how it did on a handful of TEST cases and said nothing about how it is doing on the actual work,
// which is the question the owner has.
//
// This is the pure half: turning retained verdicts for one app's runs into what its owner needs to read.
// Zero IO.

export interface Verdict {
  runId: string;
  /** 0..1 */
  quality: number;
  /** 0..1 */
  faithfulness: number;
  /** False when the judge could not score it — never counted as a pass OR a fail. */
  judged: boolean;
  reasoning: string;
  /** ISO. */
  ts: string;
}

export interface RealCaseQuality {
  /** Verdicts that actually carry a judgement. */
  judged: number;
  /** Runs the judge could not score. Reported, never silently dropped. */
  unjudged: number;
  /**
   * Finished cases with NO verdict at all — never scored.
   *
   * The largest and least visible state: scoring is best-effort and out of band, so most finished runs
   * simply have no row. Measured on this tenant: 10 finished, 1 scored. Coverage has to be stated or
   * an average over one case reads as an average over the app.
   */
  neverScored: number;
  /** Mean quality across judged verdicts, 0..1. Null when nothing was judged. */
  averageQuality: number | null;
  /** How many fell below the bar. */
  belowBar: number;
  /** The worst recent one, so a person can go and look at a real example. */
  worst: Verdict | null;
  /** One sentence for the surface. Never a bare average. */
  sentence: string;
}

/** Below this, a judged answer is not good enough to leave alone. */
export const REAL_CASE_BAR = 0.7;

/**
 * Summarise how an app is doing on the work it actually does.
 *
 * An UNJUDGED verdict is counted separately and never folded into the average. A run the judge could not
 * score is not a good run and not a bad one, and quietly averaging it in either direction would move the
 * one number the owner trusts.
 */
export function qualityOnRealCases(
  verdicts: readonly Verdict[],
  /** How many cases actually finished, so coverage can be stated rather than implied. */
  finishedCases: number,
  bar = REAL_CASE_BAR,
): RealCaseQuality {
  const judged = verdicts.filter((v) => v.judged);
  const unjudged = verdicts.length - judged.length;
  const neverScored = Math.max(0, finishedCases - verdicts.length);

  if (judged.length === 0) {
    return {
      judged: 0,
      unjudged,
      neverScored,
      averageQuality: null,
      belowBar: 0,
      worst: null,
      sentence:
        finishedCases > 0
          ? `None of the ${finishedCases} finished ${finishedCases === 1 ? 'case has' : 'cases have'} been scored, so nothing is known about quality on real work.`
          : 'No cases have finished yet, so there is nothing to score.',
    };
  }

  const avg = judged.reduce((n, v) => n + v.quality, 0) / judged.length;
  const below = judged.filter((v) => v.quality < bar);
  const worst = [...judged].sort((a, b) => a.quality - b.quality)[0] ?? null;
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  // Coverage first. An average over one of ten finished cases is not this app's quality, and a reader
  // shown only the average will take it as one.
  const coverage =
    neverScored > 0
      ? ` Only ${judged.length} of ${finishedCases} finished cases ${judged.length === 1 ? 'has' : 'have'} been scored.`
      : '';
  const tail =
    (unjudged > 0 ? ` ${unjudged} could not be scored.` : '') + coverage;

  if (below.length === 0) {
    return {
      judged: judged.length,
      unjudged,
      neverScored,
      averageQuality: avg,
      belowBar: 0,
      worst,
      sentence: `Scored ${pct(avg)} on average across ${judged.length} real ${judged.length === 1 ? 'case' : 'cases'}, none below the bar.${tail}`,
    };
  }
  return {
    judged: judged.length,
    unjudged,
    neverScored,
    averageQuality: avg,
    belowBar: below.length,
    worst,
    sentence: `${below.length} of ${judged.length} real ${judged.length === 1 ? 'case' : 'cases'} scored below ${pct(bar)} — average ${pct(avg)}.${tail}`,
  };
}
