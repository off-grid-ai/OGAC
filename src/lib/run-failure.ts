// ─── Why it could not finish, in the owner's language ────────────────────────────────────────────────
//
// A failed run opened with a JSON dump of its input, a red "Failed" chip and `3/6 steps` — and nowhere
// a sentence saying why. The reason existed, one step down, in text like:
//
//   "agent step blocked: PII masking required but the masker could not screen:
//    llm-guard POST 502: {"error":"guardrail shard unavailable","shards":["pii"]}"
//
// That is unreadable to the person who owns the process, and it names the underlying engine, which we
// have a standing rule never to surface. So the business owner's only recourse was to ask someone
// technical — the exact dependency the product claims to remove.
//
// This is the pure translation. Zero IO.

export interface FailedStep {
  label?: string;
  kind?: string;
  status?: string;
  detail?: string;
}

export interface FailureExplanation {
  /** The step it stopped at, in the author's words. Null when no step is marked failed. */
  where: string | null;
  /** One sentence a process owner can act on. Never empty. */
  why: string;
  /** What they can do about it. Null when there is nothing honest to suggest. */
  nextStep: string | null;
  /** The original text, preserved for whoever IS technical. Null when the run recorded none. */
  technicalDetail: string | null;
}

/**
 * Cause patterns, most specific first.
 *
 * Each translation says what happened to THE WORK, not what happened to a component. "The safety check
 * that removes personal data could not run" is actionable; "llm-guard POST 502" is a support ticket.
 * Engine and product names are deliberately absent — a reader should never have to learn our stack to
 * understand their own process.
 */
const CAUSES: { match: RegExp; why: string; nextStep: string | null }[] = [
  {
    match: /mask|masker|pii|personal data/i,
    why: 'It stopped because the check that removes personal data could not run, and your rules do not allow the case to continue without it.',
    nextStep: 'Nothing was exposed. Retry the case — if it stops again, the safety service needs attention.',
  },
  {
    match: /guardrail|unsafe|toxic|injection/i,
    why: 'A safety check stopped this case rather than letting it continue.',
    nextStep: 'Open the case to see which check stopped it.',
  },
  {
    match: /\b(permission|denied|forbidden|not allowed|unauthorized|403)\b/i,
    why: 'It was not allowed to read something it needed.',
    nextStep: 'Someone with access rights needs to grant this app that data source.',
  },
  {
    match: /\b(timeout|timed out|deadline|etimedout)\b/i,
    why: 'It waited too long for another system to answer and gave up.',
    nextStep: 'Retry the case. If it keeps timing out, that system is too slow or down.',
  },
  {
    match: /\b(unavailable|502|503|504|econnrefused|enotfound|connection refused|socket hang up)\b/i,
    why: 'A system this process depends on was unavailable.',
    nextStep: 'Retry the case once that system is back. Nothing was half-written.',
  },
  {
    match: /\b(quota|rate limit|429|budget|spend limit)\b/i,
    why: 'It hit a usage limit set for this process.',
    nextStep: 'Someone needs to raise the limit, or wait for it to reset.',
  },
  {
    match: /\b(blocked|refused|policy)\b/i,
    why: 'A policy rule stopped this case rather than letting it continue.',
    nextStep: 'Open the case to see which rule applied.',
  },
  {
    match: /\b(invalid|malformed|parse|schema|missing (field|value))\b/i,
    why: 'The information this case arrived with was not in the shape the process expects.',
    nextStep: 'Check the case details — something required is missing or in the wrong format.',
  },
];

/** What each kind of step is FOR, so "where it stopped" means something without the step's label. */
const KIND_PHRASE: Record<string, string> = {
  'connector-query': 'while reading data',
  agent: 'while the AI was assessing the case',
  guardrail: 'during a safety check',
  human: 'while waiting for a person',
  output: 'while producing the result',
  action: 'while carrying out an action',
};

/**
 * Explain a failed run.
 *
 * When no step is marked failed — which happens: one measured run had `agent:error` with no detail at
 * all, another had none marked — we say we do not know, rather than picking the last step and implying
 * it was the culprit. A confident wrong answer here sends someone to fix the wrong thing.
 */
export function failureExplanation(steps: readonly FailedStep[] | undefined): FailureExplanation {
  const failed = (steps ?? []).find((s) => s.status === 'error');
  const detail = failed?.detail?.trim() || null;
  const where = failed?.label?.trim() || null;

  if (!failed) {
    return {
      where: null,
      why: 'This run did not finish, and it did not record which step stopped it.',
      nextStep: 'Open the steps below — the last one that ran is where to start looking.',
      technicalDetail: null,
    };
  }

  const cause = detail ? CAUSES.find((c) => c.match.test(detail)) : undefined;
  if (cause) {
    return { where, why: cause.why, nextStep: cause.nextStep, technicalDetail: detail };
  }

  // No recognised cause. Say WHERE precisely and do not guess WHY — inventing a plausible reason is how
  // someone ends up investigating a system that was working.
  const phrase = failed.kind ? KIND_PHRASE[failed.kind] : null;
  return {
    where,
    why: `It could not finish${phrase ? ` ${phrase}` : ''}, and the reason was not recorded in a form we can explain.`,
    nextStep: detail ? 'The technical detail below is what the system reported.' : null,
    technicalDetail: detail,
  };
}

/** How far it got, in words rather than "3/6". */
export function progressSentence(steps: readonly FailedStep[] | undefined): string | null {
  const all = steps ?? [];
  if (all.length === 0) return null;
  const done = all.filter((s) => s.status === 'done').length;
  if (done === 0) return 'It stopped at the first step.';
  return `${done} of ${all.length} steps finished before it stopped.`;
}
