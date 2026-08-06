// ─── OPS COPILOT gateway adapter — the THIN I/O seam (isolated model call) ────────────────────────
//
// M5. Everything reasoning-relevant is pure (copilot-context.ts). This file is the ONLY place the
// copilot touches the network: it takes an already-built prompt and asks the platform's own gateway
// (reusing gatewayFetch) to synthesise the answer. Honest by construction:
//   • If the prompt has no facts (hasData === false), we DON'T call the model — we return a
//     deterministic "no data" answer. The moat is answering over REAL records, never hallucinating.
//   • If the gateway is unreachable / errors, we degrade to a facts-only fallback (list the cited
//     facts) rather than fabricate an answer.
// The pure request-shaping (`buildChatBody`) is exported + unit-testable without a live gateway.

import { completionBudget, readCompletion } from './chat-completion';
import { buildCopilotPrompt, type CopilotContext, type CopilotPrompt, type Citation } from './copilot-context';
import { gatewayFetch } from './gateway';
import { inferenceTimeoutMs } from './inference-timeout';

export interface CopilotAnswer {
  answer: string;
  citations: Citation[];
  /**
   * How the answer was produced — surfaced so the UI is honest about the source.
   *
   * `truncated` is separate from `fallback` on purpose: it means the model WAS reached and was working
   * (it produced reasoning) but ran out of room before the answer. Reporting that as unavailability
   * sends an operator to check a healthy gateway.
   */
  source: 'gateway' | 'no-data' | 'fallback' | 'truncated';
  /**
   * What was asked about. A screen explanation legitimately has no records behind it, so the UI must
   * not caption it "no underlying records were available" as though something had failed.
   */
  kind?: 'page' | 'platform';
  hasData: boolean;
}

/**
 * Which model answers operator questions.
 *
 * WHY THIS IS NOT QWYTHOS ANY MORE. Measured on the live box 2026-08-05: a single copilot question
 * took **235 seconds** on `qwythos-9b-1m` (the 9B RPC cluster on g7). The guide sat on "Reading the
 * live records…" for four minutes, which is not a usable surface for someone looking around a demo.
 * The same question on `qwen35-2b` (g3) answers in ~28s with reasoning on, and ~1.2s with it off.
 *
 * Overridable by env so the fleet can repoint without a deploy; the default is the fast model because
 * an interactive question should be answered while the reader is still looking at the screen.
 */
export const COPILOT_MODEL = process.env.OFFGRID_COPILOT_MODEL ?? 'qwen35-2b';

/**
 * Answer tokens requested; the budget helper multiplies this for reasoning headroom, giving a 16,000
 * token ceiling.
 *
 * Sized generously on purpose. `max_tokens` is a CEILING, not an allocation — with thinking off the
 * model stops on its own after a few hundred tokens (measured: a full answer in 54), so unused budget
 * costs nothing, while an exhausted budget costs the entire answer and returns empty content. The
 * model serves its full native 262,144-token context on g3, so there is no reason to be mean here.
 */
const COPILOT_ANSWER_TOKENS = 4_000;

/**
 * Whether to let the model think before answering. **Defaults to OFF, and that default is a
 * measurement, not a preference.**
 *
 * Qwen3.5 is a reasoning model, and on the question "what does an audit trail prove?" — about as
 * simple as this surface gets — it behaved like this on the live box:
 *
 *   thinking ON,  max_tokens 2000 → 9,635 chars of reasoning,  EMPTY answer (hit the ceiling)
 *   thinking ON,  max_tokens 4000 → 6,226 chars of reasoning,  answered, 28.5s
 *   thinking ON,  max_tokens 6000 → 21,767 chars of reasoning, EMPTY answer (hit the ceiling)
 *   thinking OFF, max_tokens 300  → answered in 54 tokens, ~1.2s
 *
 * Note the third line against the second: a LARGER budget produced a WORSE outcome on the same
 * prompt. This is not something a bigger ceiling fixes — the model does not reliably decide to stop,
 * so raising the budget mostly buys a longer wait before the same empty reply. With thinking off it
 * answers in about a second, every time.
 *
 * Set OFFGRID_COPILOT_THINKING=true to turn it back on (worth revisiting on a larger model, where the
 * stopping behaviour is better). Note that `/no_think` in the prompt does NOT work on this build —
 * measured: 1,249 chars of reasoning and an empty answer. The template kwarg is the only switch that
 * takes effect, and it requires the server to run with `--jinja`.
 */
const COPILOT_THINKING = process.env.OFFGRID_COPILOT_THINKING === 'true';

/** Pure: shape the OpenAI-compatible chat body from a built prompt. No I/O. */
export function buildChatBody(prompt: CopilotPrompt): Record<string, unknown> {
  return {
    model: COPILOT_MODEL,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    max_tokens: completionBudget(COPILOT_ANSWER_TOKENS),
    // Passed through the aggregator to llama.cpp's chat template. Harmless to a model that has no
    // thinking mode, so this stays correct if the copilot is repointed at a non-reasoning model.
    chat_template_kwargs: { enable_thinking: COPILOT_THINKING },
    temperature: 0.1,
    stream: false,
  };
}

/**
 * Pure: what to say when the model was reached and working but ran out of room before answering.
 *
 * Deliberately NOT the "unavailable" wording: the difference matters to whoever has to act on it, and
 * claiming an outage that isn't happening is its own defect.
 */
export function truncatedAnswer(citations: Citation[]): string {
  const lines = citations.map((c) => `- ${c.text} [${c.n}]`);
  return [
    'The answer was cut short before it finished, so here are the records it was working from:',
    '',
    ...lines,
  ].join('\n');
}

/** Pure: a deterministic answer when the model can't/shouldn't be used — lists the real facts. */
export function factsFallback(citations: Citation[]): string {
  if (citations.length === 0) {
    return 'I have no platform records to answer this question yet. Check that the relevant module (audit, finops, drift, or evals) is configured and has recorded activity.';
  }
  const lines = citations.map((c) => `- ${c.text} [${c.n}]`);
  return ['Here is what the platform records show (answer generation is unavailable, so these are the raw facts):', '', ...lines].join('\n');
}

/**
 * Answer an operator question over gathered spine context. The context is gathered by the caller
 * (route) via the existing reader libs and passed in — this function does the prompt build + the
 * single isolated gateway call. Never throws; degrades honestly.
 */
export async function answerCopilot(
  ctx: CopilotContext,
  // The shared inference budget (default 300s, the aggregator's own upstream allowance) rather than a
  // local 30s. A reasoning model on CPU-class on-prem hardware needs far more than 30s on a real
  // prompt, and the abort surfaced to the user as "the AI is unavailable".
  timeoutMs = inferenceTimeoutMs(process.env),
): Promise<CopilotAnswer> {
  const prompt = buildCopilotPrompt(ctx);
  const kind: CopilotAnswer['kind'] = prompt.hasData ? 'platform' : 'page';

  // Gated on `answerable`, not `hasData`. A page explanation has no records by nature and is still
  // perfectly answerable from the screen's own description; gating on hasData meant the model was
  // never called and the reader got a canned "no platform records" for "what is this page?".
  if (!prompt.answerable) {
    return { answer: factsFallback([]), citations: [], source: 'no-data', hasData: false, kind: 'platform' };
  }

  try {
    const res = await gatewayFetch('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildChatBody(prompt)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      // A 200 with empty `content` is NOT an outage. See chat-completion.ts: a reasoning model that ran
      // out of budget emits only `reasoning_content`, and reading `content` alone made that look
      // identical to an unreachable gateway.
      const outcome = readCompletion(await res.json());
      if (outcome.kind === 'answer') {
        // hasData reports the TRUTH about records, so a page explanation says false and the UI can
        // caption it honestly rather than implying a failed lookup.
        return { answer: outcome.text, citations: prompt.citations, source: 'gateway', hasData: prompt.hasData, kind };
      }
      if (outcome.kind === 'truncated-before-answer') {
        return {
          answer: truncatedAnswer(prompt.citations),
          citations: prompt.citations,
          source: 'truncated',
          kind,
          hasData: true,
        };
      }
    }
  } catch {
    /* gateway unreachable — fall through to the facts-only fallback */
  }

  return {
    answer: factsFallback(prompt.citations),
    citations: prompt.citations,
    source: 'fallback',
    hasData: prompt.hasData,
    kind,
  };
}
