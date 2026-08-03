// ─── Quality checks, as the person who owns the app reads them ───────────────────────────────────────
//
// Two defects on one line. The check TITLES are already written for a person ("No personal data in the
// output"), and the line underneath undid it:
//
//     faithfulness · quality checks · threshold 0.8 · higher-better
//     pii_leakage · guardrails · threshold 0.01 · lower-better
//
// Those are the underlying engine's metric ids, which we have a standing rule never to surface — and
// "threshold 0.8 · higher-better" asks a reader to work out what passing means.
//
// Separately: the tab had a Run button per check and NO LAST RESULT. The result display existed but was
// filled only by clicking Run in that session, so opening the tab could never answer the one question it
// exists for — "is this app OK right now?".
//
// Pure. Zero IO.

/** What each check actually looks for, in the owner's words. Keyed by the engine's metric id. */
const PLAIN: Record<string, string> = {
  faithfulness: 'Checks the answer only says what its sources actually support.',
  answer_relevancy: 'Checks the answer addresses what was asked, not something adjacent.',
  context_precision: 'Checks the sources it pulled were the relevant ones.',
  context_recall: 'Checks it found all the sources it needed, not just some.',
  pii_leakage: 'Checks no personal data reaches the output.',
  toxicity: 'Checks the wording stays acceptable.',
  prompt_injection: 'Checks hidden instructions in the input cannot redirect it.',
  hallucination: 'Checks it does not state things its sources never said.',
  groundedness: 'Checks every claim traces back to a source.',
  bias: 'Checks the wording does not skew for or against a group.',
  refusal: 'Checks it declines what it should decline.',
  exact_match: 'Checks the answer matches the expected one exactly.',
  similarity: 'Checks the answer is close enough to the expected one.',
};

/**
 * A sentence describing what a check does, or null when we do not have one.
 *
 * Null rather than a humanised metric id: turning `context_precision` into "Context precision" looks
 * like an explanation while explaining nothing, and it still leaks the engine's vocabulary.
 */
export function checkDescription(metric: string): string | null {
  return PLAIN[metric.toLowerCase().trim()] ?? null;
}

/**
 * What passing means, in plain terms.
 *
 * "threshold 0.8 · higher-better" makes the reader do the arithmetic and the logic. Lower-better checks
 * are the ones that actually confuse people: 0.01 lower-better means "essentially none allowed", which
 * nobody derives at a glance.
 */
export function passingRule(threshold: number, direction: string): string {
  const lowerBetter = /lower/i.test(direction);
  const pct = Math.round(threshold * 100);
  if (lowerBetter) {
    if (pct <= 1) return 'Passes only if this essentially never happens.';
    return `Passes if this stays under ${pct}%.`;
  }
  return `Passes at ${pct}% or better.`;
}

export interface CheckRunSummary {
  passed: number;
  total: number;
  /** ISO. */
  startedAt: string;
}

/** A past eval run, as this matcher needs it. */
export interface PastRun {
  /** The engine's compound id, `metric:suite`. */
  engine: string;
  passed: number;
  total: number;
  startedAt: string;
  pipelineId?: string | null;
}

/**
 * The most recent run of each check.
 *
 * Runs are matched by METRIC, taken from the part of `engine` before the colon — `eval_runs` carries no
 * definition id, so this is the only honest join available. A run bound to the same pipeline is
 * preferred over an unbound one: an unbound run measured the gateway in general, not this app, and
 * showing it as this app's result would overstate what we know.
 */
export function lastRunPerCheck(
  checks: readonly { id: string; metric: string; pipelineId?: string | null }[],
  runs: readonly PastRun[],
): Record<string, CheckRunSummary> {
  const out: Record<string, CheckRunSummary> = {};
  for (const check of checks) {
    const metric = check.metric.toLowerCase().trim();
    const candidates = runs.filter((r) => (r.engine ?? '').split(':')[0].toLowerCase().trim() === metric);
    if (candidates.length === 0) continue;
    const bound = candidates.filter((r) => r.pipelineId && r.pipelineId === check.pipelineId);
    const pool = bound.length > 0 ? bound : candidates;
    const newest = pool.reduce((best, r) => (r.startedAt > best.startedAt ? r : best), pool[0]);
    out[check.id] = { passed: newest.passed, total: newest.total, startedAt: newest.startedAt };
  }
  return out;
}

export type OverallVerdict = 'passing' | 'failing' | 'never-run' | 'partly-run';

export interface Overall {
  verdict: OverallVerdict;
  /** One sentence answering "is this app OK right now?". */
  sentence: string;
}

/**
 * The verdict the tab exists to give.
 *
 * A never-run check is NOT counted as passing. The whole point is that "we have never checked" and
 * "we checked and it was fine" are different answers, and only one of them means the app is OK.
 */
export function overallVerdict(
  checks: readonly { id: string; threshold: number; direction: string }[],
  last: Record<string, CheckRunSummary>,
): Overall {
  if (checks.length === 0) {
    return {
      verdict: 'never-run',
      sentence: 'No checks are set up for this app, so nothing is being verified.',
    };
  }
  const ran = checks.filter((c) => last[c.id]);
  if (ran.length === 0) {
    return {
      verdict: 'never-run',
      sentence: 'These checks have never been run, so nobody can say whether this app is working.',
    };
  }
  const failing = ran.filter((c) => {
    const r = last[c.id];
    if (r.total === 0) return false;
    const share = r.passed / r.total;
    return /lower/i.test(c.direction) ? share < 1 - c.threshold : share < c.threshold;
  });

  if (failing.length > 0) {
    return {
      verdict: 'failing',
      sentence: `${failing.length} of ${ran.length} checks did not pass when last run.`,
    };
  }
  if (ran.length < checks.length) {
    return {
      verdict: 'partly-run',
      sentence: `${ran.length} of ${checks.length} checks passed when last run — the rest have never been run.`,
    };
  }
  return {
    verdict: 'passing',
    sentence: `All ${ran.length} checks passed when last run.`,
  };
}

/** "3 days ago" — for the last-run stamp, without pulling in a date library. */
export function agoText(iso: string, now: Date): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'at an unrecorded time';
  const mins = Math.floor((now.getTime() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
