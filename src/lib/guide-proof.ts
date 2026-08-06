// ─── "Prove it" — the claims a buyer needs settled, each with a live number (PURE, zero-IO) ────────
//
// WHY THIS EXISTS, AND WHY IT IS NOT THE CHATBOT.
//
// The guide answers typed questions. That is the right shape for someone who knows what to ask, and
// the wrong shape for the reader this product is actually being sent to: an investor or an enterprise
// buyer, alone on an operator console, who has never seen it. Watching real sessions, their doubts are
// specific and always the same five:
//
//   1. Is this real software, or a mock-up with seeded screenshots?
//   2. Does the governance DO anything, or is it a label on a page?
//   3. Would this survive my auditor?
//   4. Does my data leave?
//   5. What does it cost, and what does it save?
//
// Three things make a chat answer a bad instrument for those. It takes ~7s on on-prem hardware, so
// five questions is a minute of watching a loader. The reader has to know to ask them. And — the
// disqualifying one — the answer is model-generated, so the single most important claim ("this is
// real") is delivered by the component least able to prove it. A number a model wrote is not evidence.
//
// So a proof point is COMPUTED, never generated: the same readers that back the pages produce the
// figure, and the card links to the page where the reader can see it for themselves. It renders
// instantly, it cannot hallucinate, and every claim ends in "go and check".
//
// The honesty rule is the whole value. A claim whose number is unavailable says so and stays on the
// list; it does not quietly disappear, and it never falls back to a plausible-looking constant. A
// buyer who catches one invented number stops believing the other four.

/** A single claim, its live evidence, and where to verify it. */
export interface ProofPoint {
  id: string;
  /** The doubt this settles, in the reader's words. */
  claim: string;
  /** The live figure. Null when the underlying source could not be read. */
  value: string | null;
  /** What the figure means — one line, no jargon. */
  detail: string;
  /** Where to go and check it. */
  href: string;
  /** Label for the link. */
  linkLabel: string;
}

/** The raw figures a caller gathers. Every field optional: a source may be down or unconfigured. */
export interface ProofInput {
  /** Governed runs completed (apps + agents + chat). */
  runsCompleted?: number | null;
  /** Cases currently waiting for a human decision. */
  casesWaiting?: number | null;
  /**
   * Requests screened on their way out, and how many were masked or blocked.
   *
   * This is the evidence for "the controls do something", so it comes from the recorded decisions —
   * not from whether a protection is switched on. A configured control that never fired proves
   * nothing, and a config flag rendered as a proof point is the exact move this surface rejects.
   */
  egressTotal?: number | null;
  egressProtected?: number | null;
  /** Signed, re-verifiable provenance records. */
  signedRecords?: number | null;
  /** Audit events recorded. */
  auditEvents?: number | null;
  /** Share of model requests served on the customer's own hardware, 0..1. */
  localShare?: number | null;
  /** Estimated value and actual AI cost, already in the org's currency, pre-formatted. */
  valueSaved?: string | null;
  aiCost?: string | null;
}

const UNAVAILABLE = null;

function count(n: number | null | undefined): string | null {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-IN') : UNAVAILABLE;
}

function pct(fraction: number | null | undefined): string | null {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return UNAVAILABLE;
  return `${Math.round(fraction * 100)}%`;
}

/**
 * Build the proof list, in the order the doubts actually arrive.
 *
 * "Is it real" comes first because nothing else is worth reading until it is settled, and it is the
 * cheapest to prove: a run count is a thing that either happened or did not.
 */
export function buildProofPoints(input: ProofInput): ProofPoint[] {
  const runs = count(input.runsCompleted);
  const waiting = count(input.casesWaiting);
  const egress = count(input.egressTotal);
  const guarded = count(input.egressProtected);
  const signed = count(input.signedRecords);
  const audit = count(input.auditEvents);
  const local = pct(input.localShare);

  return [
    {
      id: 'real',
      claim: 'This is running software, not a mock-up.',
      value: runs,
      // Each `detail` is assembled from the parts that ARE readable. Interpolating a missing figure
      // into a sentence is how "null pieces of work have been completed" ships — the sentence has to
      // shrink when a source is down, not carry a hole.
      detail: sentence(
        clause(runs, (n) => `${n} pieces of work have been completed here, end to end`),
        waiting === '0' ? null : clause(waiting, (n) => `and ${n} are waiting on a person right now`),
      ),
      href: '/operations/runs',
      linkLabel: 'Open any run and read its steps',
    },
    {
      id: 'private',
      claim: 'Your data does not leave your network.',
      value: local,
      detail: sentence(
        clause(local, (n) => `${n} of requests were answered on hardware in this building`),
        'the rest are screened before anything is allowed out',
      ),
      href: '/governance/egress',
      linkLabel: 'See what can and cannot leave',
    },
    {
      id: 'governed',
      claim: 'The controls actually stop things.',
      // The number that MAKES the claim is how many were stopped or stripped — not how many times a
      // check ran, and certainly not whether a protection is switched on.
      value: guarded,
      detail: sentence(
        clause2(egress, guarded, (t, g) => `Of ${t} requests screened on their way out, ${g} had sensitive details removed or were refused outright`) ??
          clause(guarded, (g) => `${g} outbound requests had sensitive details removed or were refused outright`),
        'a control that never fires is not evidence',
      ),
      href: '/governance/egress',
      linkLabel: 'Read the decisions, one by one',
    },
    {
      id: 'auditable',
      claim: 'An auditor can re-verify every claim.',
      value: signed,
      detail: sentence(
        clause(signed, (n) => `${n} records carry a signature that still checks out today`),
        clause(audit, (n) => `alongside ${n} recorded actions`),
        'any of them can be re-verified in front of you, on demand',
      ),
      href: '/governance/evidence/provenance',
      linkLabel: 'Re-verify a signed record',
    },
    {
      id: 'worth-it',
      claim: 'It pays for itself.',
      value: input.valueSaved ?? UNAVAILABLE,
      detail: sentence(
        clause(input.valueSaved ?? null, (v) => `${v} of staff time saved`),
        clause(input.aiCost ?? null, (v) => `against ${v} of AI cost`),
        'counted from work that actually ran, not projected',
      ),
      href: '/insights/outcomes',
      linkLabel: 'See the return',
    },
  ];
}

/** Render a clause only when its figure was readable. The null IS the sentence's decision to shrink. */
function clause<T>(value: T | null, render: (v: T) => string): string | null {
  return value === null ? null : render(value);
}

/** Same, for a clause that needs two figures and must be dropped if either is missing. */
function clause2<A, B>(a: A | null, b: B | null, render: (a: A, b: B) => string): string | null {
  return a === null || b === null ? null : render(a, b);
}

/** Join the clauses that exist into one sentence, dropping the ones whose figure was unreadable. */
function sentence(...clauses: (string | null)[]): string {
  const kept = clauses.filter((c): c is string => Boolean(c));
  return kept.length ? `${kept.join(', ')}.` : '';
}

/**
 * The line shown when a figure could not be read.
 *
 * Deliberately says the source could not be read rather than showing a zero. A zero is a CLAIM — "no
 * requests were blocked" — and stating it when the truth is "we could not ask" is the failure this
 * whole surface exists to avoid.
 */
export const PROOF_UNAVAILABLE = 'Not available right now — this reads from a live source.';

/** True when at least one proof point has a real figure, i.e. the panel is worth rendering. */
export function hasAnyProof(points: readonly ProofPoint[]): boolean {
  return points.some((p) => p.value !== null);
}
