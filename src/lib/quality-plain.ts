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

/** Short plain-language NAMES, for a label or a stat tile where a full sentence will not fit. */
const LABEL: Record<string, string> = {
  faithfulness: 'Faithful to sources',
  answer_relevancy: 'Answers the question',
  context_precision: 'Pulled the right sources',
  context_recall: 'Found all the sources',
  pii_leakage: 'No personal data leaked',
  toxicity: 'Acceptable wording',
  prompt_injection: 'Resists hidden instructions',
  hallucination: 'No invented claims',
  groundedness: 'Every claim traceable',
  bias: 'No skew for or against a group',
  refusal: 'Declines what it should',
  exact_match: 'Exact match to expected',
  similarity: 'Close to expected',
  golden: 'Known-good answers',
  geval: 'Reviewed by a model',
};

/**
 * A short name for a check, from its stored engine id.
 *
 * Two jobs. It strips the ENGINE SUFFIX — ids arrive as `faithfulness:ragas`, `answer_relevancy:ragas`,
 * `pii_leakage:heuristic` — because the library that computed a score is not something a business
 * reader should have to see, and this vocabulary leaked onto every quality surface. And it falls back
 * to a humanised metric name rather than null, because unlike `checkDescription` this is used where a
 * label is structurally required; showing the raw id there is the failure mode being fixed.
 */
export function checkLabel(engine: string): string {
  const raw = (engine ?? '').trim();
  if (!raw) return 'Unattributed check';
  const metric = raw.split(':')[0].toLowerCase();
  const known = LABEL[metric];
  if (known) return known;
  return metric.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

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

// ─── Test cases that belong to a shared pipeline ──────────────────────────────────────────────────────
//
// The Quality tab of "Expense Claim Approval (fidelity check)" listed cases titled
// "Reimbursement Approval: answer using a source this pipeline does not allow." and
// "Reimbursement Approval (copy): …". They belong to the shared pipeline and the page says so in prose —
// but the effect is a person reading another app's cases under theirs and concluding the screen is wrong.
// One case also appeared twice with different expectations.

export interface RawCase {
  id: string;
  query: string;
  expected: string;
}

export interface PresentedCase {
  id: string;
  /** The question, with any "<App name>: " prefix lifted out of it. */
  query: string;
  expected: string;
  /** The app the case was written for, when its query named one. Null when it names none. */
  fromApp: string | null;
}

/**
 * Lift the app name out of the case text and drop exact duplicates.
 *
 * The prefix is SHOWN, as a tag, not deleted: these cases really do come from a sibling app on the same
 * pipeline, and hiding that would make the list look like it was written for this app when it was not.
 * Naming the source turns a confusing screen into an accurate one.
 */
export function presentCases(cases: readonly RawCase[]): PresentedCase[] {
  const seen = new Set<string>();
  const out: PresentedCase[] = [];
  for (const c of cases) {
    const m = /^([^:]{3,60}):\s*(.+)$/.exec(c.query.trim());
    const fromApp = m ? m[1].trim() : null;
    const query = m ? m[2].trim() : c.query.trim();
    // Dedupe on the MEANING (question + expectation), not the id — the same case attached twice is one
    // case to a reader, and showing it twice reads as a bug in the product.
    const key = `${query.toLowerCase()}|${c.expected.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: c.id, query, expected: c.expected.trim(), fromApp });
  }
  return out;
}

// ─── Is it getting better or worse? ──────────────────────────────────────────────────────────────────
//
// The Quality tab could say what happened LAST time and nothing about direction — and direction is the
// thing that tells you whether a change helped. The data was already there: 5–6 recorded runs per
// pipeline spanning six weeks on this tenant, with nothing plotting them.

export interface TrendPoint {
  /** ISO. */
  at: string;
  /** Share of cases that passed, 0..1. */
  rate: number;
}

export type TrendDirection = 'improving' | 'declining' | 'steady' | 'too-few';

export interface Trend {
  direction: TrendDirection;
  points: TrendPoint[];
  /** One sentence. Never a bare percentage delta. */
  sentence: string;
}

/** Below this many runs there is no trend, only noise. */
const MIN_POINTS = 3;
/** Movement smaller than this is not a signal — it is the same result measured twice. */
const NOISE = 0.05;

/**
 * Read the direction from a check's recorded runs.
 *
 * Compares the most recent run to the MEDIAN of the earlier ones rather than to the single previous run:
 * one bad run next to one good run is a coin flip, and calling that "declining" trains people to ignore
 * the label. With fewer than three runs it says so instead of drawing a line through two dots.
 */
export function trendOf(runs: readonly CheckRunSummary[]): Trend {
  const points: TrendPoint[] = [...runs]
    .filter((r) => r.total > 0)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((r) => ({ at: r.startedAt, rate: r.passed / r.total }));

  if (points.length < MIN_POINTS) {
    return {
      direction: 'too-few',
      points,
      sentence:
        points.length === 0
          ? 'Never run, so there is nothing to compare.'
          : `Only ${points.length} run${points.length === 1 ? '' : 's'} recorded — too few to say whether it is improving.`,
    };
  }

  const latest = points[points.length - 1].rate;
  const earlier = points.slice(0, -1).map((p) => p.rate).sort((a, b) => a - b);
  const mid = Math.floor(earlier.length / 2);
  const baseline =
    earlier.length % 2 === 1 ? earlier[mid] : (earlier[mid - 1] + earlier[mid]) / 2;
  const delta = latest - baseline;
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  if (Math.abs(delta) < NOISE) {
    return {
      direction: 'steady',
      points,
      sentence: `Holding around ${pct(latest)} across ${points.length} runs.`,
    };
  }
  if (delta > 0) {
    return {
      direction: 'improving',
      points,
      sentence: `Up to ${pct(latest)} from ${pct(baseline)} typical — better than it was.`,
    };
  }
  return {
    direction: 'declining',
    points,
    sentence: `Down to ${pct(latest)} from ${pct(baseline)} typical — worse than it was. Something changed.`,
  };
}

/** Every recorded run of each check, oldest first — the input to trendOf. */
export function runsPerCheck(
  checks: readonly { id: string; metric: string; pipelineId?: string | null }[],
  runs: readonly PastRun[],
): Record<string, CheckRunSummary[]> {
  const out: Record<string, CheckRunSummary[]> = {};
  for (const check of checks) {
    const metric = check.metric.toLowerCase().trim();
    const all = runs.filter(
      (r) => (r.engine ?? '').split(':')[0].toLowerCase().trim() === metric,
    );
    // Same preference as lastRunPerCheck: a run bound to this pipeline describes THIS app; an unbound
    // one measured the gateway in general and would overstate what we know about this app.
    const bound = all.filter((r) => r.pipelineId && r.pipelineId === check.pipelineId);
    const pool = bound.length > 0 ? bound : all;
    out[check.id] = pool
      .map((r) => ({ passed: r.passed, total: r.total, startedAt: r.startedAt }))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }
  return out;
}

// ─── Has the data feeding this app shifted? ────────────────────────────────────────────────────────────
//
// Drift used to be reported on the app's Quality tab as a permanent absence — "it is tracked per dataset,
// not per app" — because `drift_runs` carried only `org_id`. The run now records which app it was for, so
// the question has a real answer. This turns those runs into the sentence its owner needs.

export interface AppDriftRun {
  status: string;
  /** 0..1 share of columns that drifted, or null when the engine did not report one. */
  driftShare: number | null;
  /** ISO. */
  startedAt: string;
}

/**
 * What to tell an app owner about drift in the data feeding it.
 *
 * Returns null when nothing has been checked — the caller reports that as a gap rather than as calm.
 * A never-checked app and a checked-and-stable app are opposite facts.
 */
export function appDriftSentence(runs: readonly AppDriftRun[]): string | null {
  const ordered = [...runs]
    .filter((r) => Number.isFinite(Date.parse(r.startedAt)))
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  if (ordered.length === 0) return null;

  const latest = ordered[0];
  const when = latest.startedAt.slice(0, 10);
  const drifted = latest.status.toLowerCase() === 'drift';
  const pct = latest.driftShare === null ? null : Math.round(latest.driftShare * 100);

  if (!drifted) {
    return `The data feeding this app looked normal when it was last checked on ${when}.`;
  }
  // Named as a reason to look, not as a failure: data moving is often the business changing, and telling
  // an owner their app is broken when the world changed would send them after the wrong thing.
  return pct === null
    ? `The data feeding this app has shifted since its baseline — last checked ${when}. Its answers were tuned on the older pattern, so they are worth re-checking.`
    : `${pct}% of the data feeding this app has shifted since its baseline — last checked ${when}. Its answers were tuned on the older pattern, so they are worth re-checking.`;
}
