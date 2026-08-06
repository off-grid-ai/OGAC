'use client';

import { useCallback, useRef, useState } from 'react';

// ─── The copilot's ANSWER half, extracted so there is exactly ONE of it ────────────────────────────
//
// AskPanel (the operator's Ops Copilot page) and GuideCopilot (the floating guide for a demo visitor)
// ask the same endpoint the same way and must keep the same honesty: when there are no underlying
// records the answer says so and no citation is invented. That rule was living inside one component,
// so a second ask-UI would have had to re-implement it — and would have drifted. This hook owns the
// call and the state; the rendering lives in CopilotAnswerView.

export interface Citation {
  n: number;
  source: string;
  text: string;
  ref?: string;
}

export interface CopilotAnswer {
  answer: string;
  citations: Citation[];
  source: 'gateway' | 'no-data' | 'fallback';
  hasData: boolean;
}

/** The honest provenance label for an answer. Never claims more than the source supports. */
export const SOURCE_LABEL: Record<CopilotAnswer['source'], string> = {
  gateway: 'Answered by the AI running on this box, over live records',
  fallback: 'The AI is unavailable — showing the raw records instead',
  'no-data': 'No records available to answer from',
};

export const MIN_QUESTION_LENGTH = 3;

export interface CopilotAsk {
  loading: boolean;
  result: CopilotAnswer | null;
  error: string | null;
  /** Ask a question. Resolves once the state has settled. */
  ask: (question: string) => Promise<void>;
  reset: () => void;
}

export function useCopilotAnswer(): CopilotAsk {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CopilotAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ─── Request sequencing: only the NEWEST question may set state ────────────────────────────────
  //
  // Observed live 2026-08-06: the guide showed "What am I looking at on See the protections that are
  // on?" above an answer explaining the Data → Catalog page. Two asks were in flight at once — the
  // guide fires one when you click a destination and another when the route changes — and whichever
  // resolved LAST won `setResult`, even when it was the older question. An answer that does not match
  // the question above it is worse than a spinner, because it reads as a real answer to what was
  // asked, and here it meant one page's explanation appearing on a different page.
  //
  // A monotonic id in a ref rather than an AbortController: the in-flight request is still worth
  // completing (the server has already done the expensive gather and model call, and the response is
  // cached downstream), we simply must not let a superseded one write. Every state write below is
  // gated on still being current.
  const requestId = useRef(0);

  const reset = useCallback(() => {
    // Also invalidates anything in flight, so a request started before a reset cannot land after it
    // and resurrect an answer the reader has just cleared.
    requestId.current += 1;
    setLoading(false);
    setResult(null);
    setError(null);
  }, []);

  const ask = useCallback(async (question: string) => {
    const query = question.trim();
    if (query.length < MIN_QUESTION_LENGTH) return;
    const id = (requestId.current += 1);
    const current = () => requestId.current === id;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      // GET, not POST. Asking a question changes nothing, and the read-only `viewer` role that every
      // public demo link uses is blocked from mutating methods at the edge — a POST here returned 403
      // to the entire audience of the floating guide (verified live 2026-08-05). See the route.
      const res = await fetch(`/api/v1/admin/copilot?q=${encodeURIComponent(query)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (current()) setError(body?.error ?? `Request failed (${res.status})`);
        return;
      }
      const answer = (await res.json()) as CopilotAnswer;
      if (current()) setResult(answer);
    } catch {
      if (current()) setError('Could not reach the copilot.');
    } finally {
      // A superseded request must NOT clear `loading` — the newer one is still running, and turning
      // the loader off underneath it would show an empty panel until the real answer arrived.
      if (current()) setLoading(false);
    }
  }, []);

  return { loading, result, error, ask, reset };
}
