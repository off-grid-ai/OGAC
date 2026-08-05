// ─── Display names for internal identifiers — pure ─────────────────────────────────────────────────
//
// OVERLAPS WITH src/lib/eval-engine-label.ts — READ THIS BEFORE ADDING A THIRD.
//
// `evalEngineLabel` already maps BARE engine ids to outcome language (ragas -> "Retrieval quality",
// evidently -> "Drift & quality") and is the right choice wherever the value is a single engine id. I
// wrote this module without finding it first, which is a DRY failure on my part.
//
// What this one does that the other cannot: sanitise COMPOUND strings where an engine or codename is
// embedded in a larger identifier — "answer_relevancy:ragas", "brain.retrieve.qdrant",
// "Knowledge base (Brain)". Those come from lineage jobs, dataset names and eval run keys, not from a
// clean id field, so a lookup table cannot match them.
//
// Rule of thumb: a bare engine id -> evalEngineLabel. An arbitrary string that may CONTAIN one ->
// publicLabel. They should be consolidated behind one entry point; logged as a gap.
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
  // Added 2026-08-05. The guide copilot falls back to the ⌘K route index for a query it has no
  // curated answer for, and that index — written for operators — has the title "Policy rules
  // (ABAC / OPA)". Sending a visitor a label naming the policy engine is the same leak as
  // `brain.retrieve.qdrant`, and `leaksInternalName` could not even detect it because these five
  // engines were missing from the list. A guard that silently passes is worse than no guard.
  [/\bopa\b|\brego\b/gi, 'policy engine'],
  [/\bpresidio\b/gi, 'pattern detection'],
  [/\blitellm\b/gi, 'model router'],
  [/\bmarquez\b/gi, 'lineage store'],
  [/\bsuperset\b/gi, 'dashboards'],
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

/**
 * The same rule under a name that says what it is for.
 *
 * This started as a lineage fix, but the leak is not lineage-specific: the Quality page's Engine column
 * showed "answer_relevancy:ragas", naming the OSS evaluator to a customer. Any surface that displays a
 * name written by an internal component should pass it through here.
 */
export const publicLabel = lineageLabel;

/** True when a label still names something internal — used by tests to guard the list. */
export function leaksInternalName(raw: string | null | undefined): boolean {
  const s = (raw ?? '').toLowerCase();
  return INTERNAL.some(([re]) => new RegExp(re.source, 'i').test(s));
}
