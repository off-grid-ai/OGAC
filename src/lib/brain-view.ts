// Pure, server-safe Brain view helpers. Extracted out of the 'use client' BrainNav so the server
// page (brain/page.tsx) can import normalizeBrainView WITHOUT pulling a client module across the RSC
// boundary (which throws: "Attempted to call normalizeBrainView() from the server but it is on the
// client"). Same pattern as src/lib/langfuse-registry.ts. Zero-import, no hooks — safe on both sides.

export const BRAIN_VIEWS = ['router', 'tools', 'retrieval', 'knowledge', 'prompts', 'evals'] as const;
export type BrainView = (typeof BRAIN_VIEWS)[number];
export const DEFAULT_BRAIN_VIEW: BrainView = 'router';

// URL param (?view) → a valid Brain view, defaulting to router. Nav-in-URL, deep-linkable.
export function normalizeBrainView(raw: string | string[] | undefined): BrainView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (BRAIN_VIEWS as readonly string[]).includes(v ?? '') ? (v as BrainView) : DEFAULT_BRAIN_VIEW;
}
