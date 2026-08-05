// ─── Reading an OpenAI-compatible chat completion honestly (PURE, zero-IO) ────────────────────────
//
// LIVE FINDING (2026-08-05). The guide copilot reported "The AI is unavailable — showing the raw
// records instead" on a gateway that was working perfectly: HTTP 200 in 2.07s. Measured on the box:
//
//   max_tokens: 16  → finish_reason "length", content "",   reasoning_content 60+ chars
//   max_tokens: 600 → finish_reason "stop",   content "OK", reasoning_content 867 chars
//
// The fleet's only model (Qwythos) is a REASONING model: it emits its chain of thought into
// `reasoning_content` and the answer into `content`. Given too small a budget it spends the whole
// allowance thinking and never reaches the answer — a 200 with an empty `content`.
//
// The caller read `choices[0].message.content` and nothing else, so "the model thought but ran out of
// room" was indistinguishable from "the gateway is down", and the UI blamed availability for a
// configuration problem. Those are different failures and an operator can only act on the real one.
//
// So this module makes the three cases distinguishable, and it lives on its own because more than one
// call site reads completions (copilot, chat, app compile) and each had its own inline `?.content`.

/** What actually came back, once the reasoning/answer split is accounted for. */
export type CompletionOutcome =
  /** A real answer. */
  | { kind: 'answer'; text: string; reasoningChars: number }
  /**
   * The model produced ONLY reasoning and was cut off before the answer — a budget problem, not an
   * outage. `reasoningChars > 0` is the evidence the model was alive and working.
   */
  | { kind: 'truncated-before-answer'; reasoningChars: number }
  /** A genuinely empty completion: nothing in content, nothing in reasoning. */
  | { kind: 'empty' };

interface RawMessage {
  content?: unknown;
  /** Non-standard but emitted by reasoning models (Qwythos, DeepSeek-R1 and friends). */
  reasoning_content?: unknown;
}
interface RawChoice {
  message?: RawMessage;
  finish_reason?: unknown;
}
interface RawCompletion {
  choices?: RawChoice[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Classify a completion payload.
 *
 * The reasoning text is deliberately NOT returned as the answer. It is a model's private working — it
 * contains false starts and self-correction, and presenting it as a conclusion is the same class of
 * defect as the source-echo fallback removed from the agent path today (dressing up something that
 * isn't an answer as one). The honest move is to say the budget ran out and let the caller retry with
 * more room.
 */
export function readCompletion(payload: unknown): CompletionOutcome {
  const choice = (payload as RawCompletion | null)?.choices?.[0];
  const text = str(choice?.message?.content).trim();
  const reasoningChars = str(choice?.message?.reasoning_content).trim().length;
  if (text) return { kind: 'answer', text, reasoningChars };
  if (reasoningChars > 0) return { kind: 'truncated-before-answer', reasoningChars };
  return { kind: 'empty' };
}

/**
 * A token allowance that leaves room for reasoning AND the answer.
 *
 * `answerTokens` is what the caller wants back. The multiplier covers the chain of thought, which on
 * the measured model runs several times the length of the answer. A budget sized only for the answer is
 * the bug this exists to prevent, so the floor is generous rather than tight.
 */
export const REASONING_HEADROOM_MULTIPLIER = 4;
export const MIN_COMPLETION_BUDGET = 1_024;

export function completionBudget(answerTokens: number): number {
  if (!Number.isFinite(answerTokens) || answerTokens <= 0) return MIN_COMPLETION_BUDGET;
  return Math.max(MIN_COMPLETION_BUDGET, Math.ceil(answerTokens * REASONING_HEADROOM_MULTIPLIER));
}
