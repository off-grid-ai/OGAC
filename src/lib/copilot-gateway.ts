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

import { buildCopilotPrompt, type CopilotContext, type CopilotPrompt, type Citation } from './copilot-context';
import { gatewayFetch } from './gateway';

export interface CopilotAnswer {
  answer: string;
  citations: Citation[];
  /** How the answer was produced — surfaced so the UI is honest about the source. */
  source: 'gateway' | 'no-data' | 'fallback';
  hasData: boolean;
}

/** Pure: shape the OpenAI-compatible chat body from a built prompt. No I/O. */
export function buildChatBody(prompt: CopilotPrompt): Record<string, unknown> {
  return {
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    max_tokens: 700,
    temperature: 0.1,
    stream: false,
  };
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
export async function answerCopilot(ctx: CopilotContext, timeoutMs = 30000): Promise<CopilotAnswer> {
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
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) {
        return { answer: text, citations: prompt.citations, source: 'gateway', hasData: true };
      }
    }
  } catch {
    /* gateway unreachable — fall through to the facts-only fallback */
  }

  return { answer: factsFallback(prompt.citations), citations: prompt.citations, source: 'fallback', hasData: true };
}
