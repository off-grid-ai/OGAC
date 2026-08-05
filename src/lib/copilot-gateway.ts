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
  hasData: boolean;
}

/** Pure: shape the OpenAI-compatible chat body from a built prompt. No I/O. */
export function buildChatBody(prompt: CopilotPrompt): Record<string, unknown> {
  return {
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    // Sized for a REASONING model. 700 was sized for the answer alone, and the fleet's only model
    // (Qwythos) spends most of its allowance in `reasoning_content` before it writes a word of
    // `content` — so on a real question it returned HTTP 200 with an EMPTY answer, and the copilot
    // told the user "The AI is unavailable" while the gateway was answering in 2 seconds.
    max_tokens: completionBudget(700),
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

  if (!prompt.hasData) {
    return { answer: factsFallback([]), citations: [], source: 'no-data', hasData: false };
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
        return { answer: outcome.text, citations: prompt.citations, source: 'gateway', hasData: true };
      }
      if (outcome.kind === 'truncated-before-answer') {
        return {
          answer: truncatedAnswer(prompt.citations),
          citations: prompt.citations,
          source: 'truncated',
          hasData: true,
        };
      }
    }
  } catch {
    /* gateway unreachable — fall through to the facts-only fallback */
  }

  return { answer: factsFallback(prompt.citations), citations: prompt.citations, source: 'fallback', hasData: true };
}
