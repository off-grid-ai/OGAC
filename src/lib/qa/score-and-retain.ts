// ─── SCORE AND RETAIN — the one place a finished run becomes a retained quality verdict ───────────
//
// Agent runs and app runs both need the identical policy: respect the online-evals flag, respect the
// sample rate, judge the interaction, retain the verdict. That policy lived inside agentrun's
// scoreRun, so app runs could only get it by copy-paste — and a duplicated sampling rule that drifts
// is exactly the defect the DRY bar exists to prevent. It lives here now; both callers pass a
// subject.
//
// Everything here is best-effort by design: scoring is an out-of-band side-effect, and it must never
// fail, slow, or alter the run it is scoring.

import { getFlags } from '@/lib/adapters/registry';
import { retainOnlineScore, toOnlineScore } from '@/lib/qa/online-scores';
import { scoreInteraction } from '@/lib/qa/scoring';

/** What was produced, and by which entity — the only things scoring needs to know. */
export interface ScoreSubject {
  runId: string;
  orgId: string;
  /** Namespaced entity id: `agent:<id>` or `app:<id>`. Becomes the trend/regression subject. */
  subjectId: string;
  input: string;
  output: string;
  sources?: string[];
  traceId?: string;
}

/**
 * Should this run be judged, given the configured sample rate? PURE.
 *
 * `roll` is the caller's random draw, injected so the decision is testable rather than a coin flip
 * hidden inside an I/O function. An unset or unparseable rate means score everything — the safe
 * default for a quality signal is to measure, not to silently sample down to nothing.
 */
export function shouldSampleForScoring(rateRaw: string | undefined, roll: number): boolean {
  const rate = Number(rateRaw ?? '1');
  if (!Number.isFinite(rate)) return true;
  return roll <= rate;
}

/** True when the interaction has both sides — nothing to judge if either is blank. PURE. */
export function scorable(subject: Pick<ScoreSubject, 'input' | 'output'>): boolean {
  return subject.input.trim().length > 0 && subject.output.trim().length > 0;
}

/**
 * Judge one finished interaction and retain the verdict. Returns whether a verdict was retained, so
 * a caller (or a test) can tell "scored" from "skipped" without inspecting the store.
 *
 * NEVER throws.
 */
export async function scoreAndRetain(subject: ScoreSubject): Promise<boolean> {
  try {
    if (!scorable(subject)) return false;
    if (!(await getFlags().isEnabled('online-evals', true))) return false;
    if (!shouldSampleForScoring(process.env.OFFGRID_QA_SAMPLE_RATE, Math.random())) return false;

    const scored = await scoreInteraction({
      input: subject.input,
      output: subject.output,
      sources: subject.sources,
      name: subject.subjectId,
      traceId: subject.traceId,
      orgId: subject.orgId,
    });

    // Retain in the console's own store so quality-over-time survives Langfuse being down or
    // undeployed, and so the regression rule has something to read.
    const retained = await retainOnlineScore(
      toOnlineScore({
        runId: subject.runId,
        orgId: subject.orgId,
        subjectId: subject.subjectId,
        quality: scored.verdict.quality,
        faithfulness: scored.verdict.faithfulness,
        judged: scored.judged,
        reasoning: scored.verdict.reasoning,
      }),
    );

    // A new verdict is the only thing that can change this subject's regression status, so this is
    // exactly when to check whether an operator should be told — no scheduler, no polling loop that
    // goes quiet precisely when the fleet is busy. Best-effort and not awaited into the caller's path;
    // it no-ops entirely when no alert destination is configured.
    if (retained) void runAlertSweepFor(subject.orgId, subject.subjectId);

    return retained;
  } catch {
    return false; // best-effort: a scoring failure is never the run's problem
  }
}

/** Dynamic import so the alerting chain never enters a caller's module graph unless a verdict lands. */
async function runAlertSweepFor(orgId: string, subjectId: string): Promise<void> {
  try {
    const { runQualityAlertSweep } = await import('@/lib/qa/quality-alert-run');
    await runQualityAlertSweep(orgId, subjectId);
  } catch {
    /* alerting is additive — it must never affect the scored run */
  }
}
