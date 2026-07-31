// ─── Lineage display names — pure ──────────────────────────────────────────────────────────────────
//
// The lineage graph rendered the names the emitters wrote, and those are INTERNAL: "Knowledge base
// (Brain)" exposes our codename, and `brain.retrieve.qdrant` names the vector engine. Neither belongs on
// a customer-facing surface — a buyer should never learn our internal architecture or which OSS parts we
// assembled from a provenance screen, and in a regulated review it invites questions about components
// rather than about the evidence.
//
// Applied at DISPLAY time rather than at emit time so it also covers the lineage already stored. The
// underlying identifiers are untouched: provenance must stay traceable, so this changes the label only.

/** Engine and codename fragments that must never reach a customer-facing label. */
const INTERNAL = [
  [/\bbrain\b/gi, 'knowledge'],
  [/\bqdrant\b/gi, 'vector index'],
  [/\bragas\b/gi, 'quality checks'],
  [/\bevidently\b/gi, 'drift checks'],
  [/\bllm[- ]?guard\b/gi, 'guardrails'],
  [/\blangfuse\b/gi, 'traces'],
  [/\bopensearch\b/gi, 'search index'],
  [/\bseaweedfs\b/gi, 'object store'],
  [/\bclickhouse\b/gi, 'warehouse'],
  [/\bkestra\b/gi, 'orchestrator'],
  [/\bkeycloak\b/gi, 'identity'],
  [/\bopenbao\b|\bvault\b/gi, 'secret store'],
] as const;

/**
 * A label safe to show a customer.
 *
 * Substitutions run on WORD boundaries so a legitimate word is never mangled, and the result is tidied of
 * the doubled separators the replacements can leave behind ("knowledge.retrieve.vector index").
 */
export function lineageLabel(raw: string | null | undefined): string {
  let out = (raw ?? '').trim();
  if (!out) return '';
  for (const [re, replacement] of INTERNAL) out = out.replace(re, replacement);
  return out
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .replace(/\s{2,}/g, ' ');
}

/** True when a label still names something internal — used by tests to guard the list. */
export function leaksInternalName(raw: string | null | undefined): boolean {
  const s = (raw ?? '').toLowerCase();
  return INTERNAL.some(([re]) => new RegExp(re.source, 'i').test(s));
}
