// ─── How long a governed model call is allowed to take ────────────────────────────────────────────
//
// LIVE FINDING (2026-08-05, on-prem demo box) that this module exists to fix. Every app whose agent
// step read a real source produced no assessment — the deployed Death-Claim Assessment app answered
// with a raw dump of its own sources instead of a risk verdict. The cause was a client-side abort,
// not the model:
//
//   • the app's real prompt (one claim document + six premium rows) took 262s to complete on the
//     on-prem node — measured directly against the aggregator, HTTP 200 in 262.205s;
//   • the agent path aborted it at a hardcoded 20 000 ms and treated the abort as "no answer".
//
// 20s was never a considered budget: the aggregator's OWN upstream allowance for the same hop is
// `timeouts.chatUpstreamMs = 300000` (see shapeGatewayTuning in gateway.ts), and the sibling image
// path already reads OFFGRID_IMAGE_TIMEOUT_MS with a 300 000 ms default. The agent path was the
// outlier, and on CPU-class on-prem hardware — where prefill, not generation, dominates — it made
// every non-trivial governed prompt unanswerable.
//
// So the budget is configurable and defaults to the gateway's own allowance rather than a number
// that silently truncates real work. Pure. Zero IO — the fetch call site applies it.

/** What the timeout falls back to: the aggregator's own upstream chat allowance. */
export const DEFAULT_INFERENCE_TIMEOUT_MS = 300_000;

/**
 * A floor. Below about a second no real completion can land, so a typo'd or zeroed env var would
 * disable inference entirely while looking like configuration rather than an outage.
 */
export const MIN_INFERENCE_TIMEOUT_MS = 1_000;

/**
 * A ceiling. An unbounded budget turns one wedged upstream into a run that never finishes and a
 * queue that never drains, which is harder to diagnose than a timeout.
 */
export const MAX_INFERENCE_TIMEOUT_MS = 1_800_000;

/**
 * The abort budget for one governed chat completion, in milliseconds.
 *
 * Reads `OFFGRID_INFERENCE_TIMEOUT_MS`. Anything unparseable — unset, blank, non-numeric, NaN,
 * Infinity, negative — falls back to the default rather than throwing: an operator's typo must not
 * take inference down, and a silent 0 must not read as "no timeout".
 */
export function inferenceTimeoutMs(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env.OFFGRID_INFERENCE_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_INFERENCE_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INFERENCE_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(parsed), MIN_INFERENCE_TIMEOUT_MS), MAX_INFERENCE_TIMEOUT_MS);
}

// ─── InferenceUnavailableError — a failed model call is a FAILURE, never an answer ─────────────────
//
// The second half of the same live finding, and the more damaging half. When the model call returned
// nothing, `compose()` substituted `Based on N source(s): <the first source verbatim>` and that
// string was then stored as the agent's answer, signed for provenance, folded into the app run's
// outcome, and rendered on the deployed app as its decision. A stranger reading the app saw a
// paragraph of raw JSON where a claim-risk verdict belonged, with nothing anywhere reporting that
// the model had not been reached.
//
// That is this repo's recurring "a failure that presents as emptiness" defect in its worst form: not
// an empty state, but a FABRICATED one that outranks an honest error, because it is indistinguishable
// from output. A model call that did not happen must fail loudly — the app executor already turns a
// thrown step into an `error` step carrying the message, which is the honest surface.
export class InferenceUnavailableError extends Error {
  constructor(reason: string) {
    super(`the model could not be reached: ${reason}`);
    this.name = 'InferenceUnavailableError';
  }
}
