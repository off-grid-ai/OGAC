// ─── Clarifying questions on a compiled app — pure ─────────────────────────────────────────────────
//
// Flow 3 in `docs/roadmap-real.md` reads: describe the goal → **"OGAC asks clarifying questions"** →
// identifies data/tools/policies → proposes a workflow. Compile is one-shot: it takes a sentence and
// returns a spec, and where the sentence was ambiguous it picks something and moves on. `gaps` reports
// what could not be wired, which is honest but is a statement, not a question — the author has no obvious
// next move.
//
// THESE ARE NOT MODEL-GENERATED QUESTIONS. Every one is derived from a concrete fact about the compiled
// spec: a step has no bound domain, an amount was described with no threshold, the sentence says "approve"
// and no human step exists. Asking a model to invent questions would produce plausible ones that may not
// correspond to anything actually underspecified — and it would ask them non-deterministically, so the same
// sentence would behave differently twice. A question here always maps to something a reader can point at
// in the spec.
//
// Each question carries the FIELD it would resolve, so the surface can take an answer and recompile rather
// than leaving the author to rewrite their sentence and guess what changed.

export interface ClarifyingQuestion {
  /** What to ask, in the author's language. */
  question: string;
  /** Why it is being asked — the fact in the spec that produced it. Never a generic prompt. */
  because: string;
  /** The step this concerns, when it concerns one. */
  stepId?: string;
  /** What an answer would set, so a follow-up can be applied rather than re-typed. */
  resolves: 'data-binding' | 'threshold' | 'approver' | 'destination' | 'schedule';
}

export interface ClarifiableStep {
  id: string;
  kind: string;
  label?: string;
  domain?: string;
  sink?: string;
  inlineAgent?: { systemPrompt?: string } | null;
}

/** Words that describe a limit without stating one. "over the limit" is not a rule a run can apply. */
const VAGUE_THRESHOLD =
  /\b(large|small|high|low|excessive|significant|unusual|too much|over the limit|above the limit|within limits?|reasonable)\b/i;

/** The author asked for a person in the loop. */
const WANTS_APPROVAL = /\b(approv\w*|sign[- ]?off|authorise|authorize|review\w*|escalat\w*)\b/i;

/** The author asked for the result to go somewhere. */
const WANTS_DELIVERY = /\b(email|notify|notification|send|inform|alert|report to|message)\b/i;

/**
 * Questions worth asking about a compiled spec, most consequential first.
 *
 * `description` is the author's original sentence — it is what tells us what they ASKED for, which is the
 * only way to notice that something they asked for is missing from the spec.
 */
export function clarifyingQuestions(
  description: string,
  steps: readonly ClarifiableStep[],
  gaps: readonly string[] = [],
): ClarifyingQuestion[] {
  const desc = (description ?? '').trim();
  const out: ClarifyingQuestion[] = [];

  // 1. An unbound read is the most consequential ambiguity: the app cannot run at all.
  for (const step of steps) {
    if (step.kind !== 'connector-query') continue;
    if (step.domain?.trim()) continue;
    out.push({
      question: `Which data source should "${step.label || step.id}" read from?`,
      because: 'This step has no source bound yet, so the app cannot run.',
      stepId: step.id,
      resolves: 'data-binding',
    });
  }

  // 2. A phrase the org's sources could not bind. `gaps` already says so; turn it into a question.
  for (const gap of gaps) {
    const m = gap.match(/no data[- ]domain (?:binds|matches) ["“]([^"”]+)["”]/i);
    if (m) {
      out.push({
        question: `Nothing in your connected sources matches "${m[1]}". Which source holds it?`,
        because: 'The phrase was recognised as data, but no declared source binds it.',
        resolves: 'data-binding',
      });
    }
  }

  // 3. A limit described without a number. The run would otherwise apply the model's own idea of "large".
  const vague = desc.match(VAGUE_THRESHOLD);
  if (vague) {
    out.push({
      question: `You described "${vague[0]}" — what value is the cut-off?`,
      because: 'Without a number, each run applies its own interpretation of that word.',
      resolves: 'threshold',
    });
  }

  // 4. Approval asked for, no human step. The governance promise is that a person reviews what matters.
  if (WANTS_APPROVAL.test(desc) && !steps.some((s) => s.kind === 'human')) {
    out.push({
      question: 'You mentioned approval — who should review this before it completes?',
      because: 'No human review step was created, so nothing would pause for a person.',
      resolves: 'approver',
    });
  }

  // 5. Delivery asked for, nothing sends. Otherwise the run decides and the result goes nowhere.
  if (WANTS_DELIVERY.test(desc) && !steps.some((s) => s.kind === 'output' || s.kind === 'action')) {
    out.push({
      question: 'Where should the result be sent, and to whom?',
      because: 'No step sends the result, so it would only be recorded in the console.',
      resolves: 'destination',
    });
  }

  // 6. An output step with no sink chosen — it exists but has no destination.
  for (const step of steps) {
    if (step.kind !== 'output' || step.sink?.trim()) continue;
    out.push({
      question: `How should "${step.label || step.id}" deliver the result?`,
      because: 'This step sends the result but no destination is set.',
      stepId: step.id,
      resolves: 'destination',
    });
  }

  return out;
}

/** True when the author should answer before publishing — an unbound read means it cannot run. */
export function blocksRun(questions: readonly ClarifyingQuestion[]): boolean {
  return questions.some((q) => q.resolves === 'data-binding');
}
