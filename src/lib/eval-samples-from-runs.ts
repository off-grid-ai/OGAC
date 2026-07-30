// ─── Eval samples built from an app's OWN runs — pure ───────────────────────────────────────────────
//
// Faithfulness asks: does the answer follow from its sources? For an app, the only defensible answer is
// "the sources THAT APP read" — its `connector-query` step outputs, already retained on the run and already
// rendered as tables for reviewers.
//
// It was previously judged against contexts from `searchDocuments()` (the organizational brain). Two
// problems with that, found by chasing a 0 score through four wrong diagnoses:
//   1. When the brain returns nothing, the sample has NO contexts, and faithfulness becomes unmeasurable by
//      every engine. Three engines reporting 0 was one missing input, not three failures.
//   2. Even when it works, it is the WRONG QUESTION. Judging an expense-claim app against a bank-policy
//      corpus tells you nothing: that app's answer should follow from the claim row and the quota rows it
//      read, and nothing else. The brain is also explicitly descoped right now.
//
// So samples come from real runs. This is strictly better evidence than a golden set: it is what the app
// actually did, on real cases, with the sources it actually used — §8H's "every production use case" read
// literally.

/** A step, reduced to what sampling needs. Structural, so this is testable without the AppRun type. */
export interface SampleStep {
  kind: string;
  status: string;
  label?: string;
  outcome?: string;
}

/** A run, reduced likewise. */
export interface SampleRun {
  id: string;
  status: string;
  steps: SampleStep[];
  /** The run's own aggregate answer, used when no agent step carries one. */
  outcome?: string;
}

export interface EvalSample {
  question: string;
  answer: string;
  contexts: string[];
  groundTruth: string;
}

/**
 * Turn one run into an eval sample, or null when it cannot honestly produce one.
 *
 * Requires BOTH an answer and at least one source. A sample with an answer and no contexts is exactly the
 * unmeasurable case that produced four wrong diagnoses — returning null keeps it out of the corpus instead
 * of scoring it 0 and calling the app unfaithful.
 */
export function sampleFromRun(run: SampleRun): EvalSample | null {
  const reads = run.steps.filter((s) => s.kind === 'connector-query' && s.status === 'done');
  const contexts = reads.map((s) => (s.outcome ?? '').trim()).filter((t) => t.length > 0);
  const agent = run.steps.find((s) => s.kind === 'agent' && s.status === 'done' && (s.outcome ?? '').trim());
  const answer = (agent?.outcome ?? run.outcome ?? '').trim();
  if (contexts.length === 0 || !answer) return null;
  return {
    // The step label is the closest thing to the question the app was answering; it is what the author
    // wrote to describe the decision.
    question: agent?.label?.trim() || 'What decision does this run support?',
    answer,
    contexts,
    // No ground truth: a production run has no expected answer. Faithfulness and relevancy do not need one
    // (they judge answer-against-sources), and metrics that DO need one must not silently score against ''.
    groundTruth: '',
  };
}

/**
 * Build samples from an app's recent runs, newest first, capped.
 *
 * Skips runs that cannot produce an honest sample rather than padding the corpus — a smaller set of real
 * samples beats a full set containing unmeasurable ones, which is the mistake the golden corpus made.
 */
export function samplesFromRuns(runs: readonly SampleRun[], limit = 5): EvalSample[] {
  const out: EvalSample[] = [];
  for (const run of runs) {
    if (out.length >= limit) break;
    const sample = sampleFromRun(run);
    if (sample) out.push(sample);
  }
  return out;
}

/** True when an app has enough real runs to evaluate. Below this, say so rather than scoring noise. */
export function hasEvaluableRuns(samples: readonly EvalSample[]): boolean {
  return samples.length > 0;
}
