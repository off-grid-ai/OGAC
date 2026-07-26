// ─── APP-RUN SCORING — making the quality signal cover the thing operators actually ship ──────────
//
// The gap this closes (G-QUALITY-REGRESSION-APPS): every governed AGENT run was judged and retained,
// but app runs never were. So the answer-quality regression surface could not see a single app — it
// would report "no decline detected" for an app whose answers were collapsing. Apps are the
// operator-facing product, so that was the coverage that mattered most.
//
// Both app execution paths (inline runApp and the durable Temporal workflow) converge on
// upsertAppRunState, so the trigger lives there — ONE seam, not one per path. A previous fix in this
// codebase had to be applied twice because two paths each folded results themselves; this avoids
// repeating that.

import type { AppRunState } from '@/lib/app-run-plan';

/**
 * The text a person actually asked, recovered from an app's trigger/form input. PURE.
 *
 * App input is an arbitrary form/webhook record, not a single query string. Prefer the fields that
 * carry a person's words; otherwise fall back to a compact rendering of the whole record so the judge
 * still sees what drove the run. Blank in, blank out — the caller declines to score that.
 */
export function appRunInputText(input: Record<string, unknown>): string {
  const PREFERRED = ['input', 'query', 'question', 'prompt', 'text', 'message', 'body'];
  for (const key of PREFERRED) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const parts = Object.entries(input)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .filter((s) => s.trim().length > 0);
  return parts.join('\n').slice(0, 4000);
}

/** The answer the app produced = its last non-empty step output. PURE. */
export function appRunOutputText(state: AppRunState): string {
  for (let i = state.steps.length - 1; i >= 0; i--) {
    const out = state.steps[i].output;
    if (out?.trim()) return out.trim();
  }
  return '';
}

/**
 * True when this state transition is the moment an app run SUCCEEDED — the only point worth judging.
 * PURE.
 *
 * `upsertAppRunState` is called after every step transition, so without this the judge would fire
 * repeatedly through a run. Errored and cancelled runs are deliberately not scored: a run that never
 * produced an answer has no answer quality, and scoring its empty output as 0 would corrupt the trend
 * with failures that belong on the reliability surface instead.
 */
export function shouldScoreAppRun(state: AppRunState): boolean {
  return state.status === 'done' && appRunOutputText(state).trim().length > 0;
}

/**
 * Judge + retain a finished app run, out of band. NEVER throws, and returns whether a verdict was
 * retained so callers/tests can distinguish scored from skipped.
 */
export async function scoreAppRun(
  state: AppRunState,
  input: Record<string, unknown>,
  orgId: string,
): Promise<boolean> {
  if (!shouldScoreAppRun(state)) return false;
  const { scoreAndRetain } = await import('@/lib/qa/score-and-retain');
  return scoreAndRetain({
    runId: state.runId,
    orgId,
    subjectId: `app:${state.appId}`,
    input: appRunInputText(input),
    output: appRunOutputText(state),
  });
}
