// PURE helpers for the admin "Workspace pipeline binding" surface — ZERO imports of db/IO/React,
// exhaustively unit-testable (mirrors chat-pipeline-policy.ts). These shape the admin FORM: which
// pipeline options to show, what the org-default dropdown offers, and validating the picked binding
// BEFORE it's PUT to /api/v1/admin/org-settings. Resolution/gating at run-time still lives in the
// pure chat-pipeline-policy.ts — this file is only about the admin form's inputs/outputs.

/** A pipeline the admin can bind Workspace to — the minimal fields the form needs. */
export interface WorkspacePipelineOption {
  id: string;
  name: string;
  /** Pipeline lifecycle status (e.g. 'published' | 'draft'); optional, used for a UI hint only. */
  status?: string;
}

/** The binding the admin form edits + persists. Mirrors the org-settings request body. */
export interface WorkspaceBindingForm {
  /** Org-default Workspace pipeline id. Empty/null ⇒ per-message model (no governed default). */
  defaultChatPipelineId: string | null;
  /** The set of pipeline ids a user may pick per project. */
  chatPipelineAllowlist: string[];
}

/**
 * Build the option list for the form, stable-sorted by name (case-insensitive) so the dropdown +
 * checkboxes are deterministic regardless of DB order. De-duplicates by id (defensive).
 */
export function buildPipelineOptions(
  pipelines: readonly WorkspacePipelineOption[],
): WorkspacePipelineOption[] {
  const seen = new Set<string>();
  const out: WorkspacePipelineOption[] = [];
  for (const p of pipelines) {
    if (!p?.id || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ id: p.id, name: p.name || p.id, status: p.status });
  }
  return out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/**
 * Normalize the raw form state into the exact request body the org-settings route expects:
 *   • empty default → null (per-message model),
 *   • allowlist de-duped, filtered to known pipeline ids, and always INCLUDING the default
 *     (a user can always fall back to the governed default — mirrors availableChatPipelines).
 * Returns a body ready to JSON.stringify for the PUT.
 */
export function toBindingRequestBody(
  defaultId: string | null | undefined,
  allowlist: readonly string[],
  knownIds: readonly string[],
): WorkspaceBindingForm {
  const known = new Set(knownIds);
  const def = defaultId && known.has(defaultId) ? defaultId : null;
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (id: string | null) => {
    if (!id || seen.has(id) || !known.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  add(def);
  for (const id of allowlist) add(id);
  return { defaultChatPipelineId: def, chatPipelineAllowlist: out };
}

/**
 * Validate the form before save. It's always legal to set NO default (per-message model) with an
 * empty allowlist. The only hard error: an allowlist entry (or default) that isn't a known pipeline
 * (stale/removed) — the form should never submit a ghost id. Returns null when valid, else a message.
 */
export function validateBinding(
  form: WorkspaceBindingForm,
  knownIds: readonly string[],
): string | null {
  const known = new Set(knownIds);
  if (form.defaultChatPipelineId && !known.has(form.defaultChatPipelineId)) {
    return 'The selected default pipeline no longer exists — pick another.';
  }
  for (const id of form.chatPipelineAllowlist) {
    if (!known.has(id)) return 'One of the allowed pipelines no longer exists — remove it and retry.';
  }
  return null;
}
