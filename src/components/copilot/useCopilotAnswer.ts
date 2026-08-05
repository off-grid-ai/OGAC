'use client';

import { useCallback, useState } from 'react';

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

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  const ask = useCallback(async (question: string) => {
    const query = question.trim();
    if (query.length < MIN_QUESTION_LENGTH) return;
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
        setError(body?.error ?? `Request failed (${res.status})`);
        return;
      }
      setResult((await res.json()) as CopilotAnswer);
    } catch {
      setError('Could not reach the copilot.');
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, result, error, ask, reset };
}
