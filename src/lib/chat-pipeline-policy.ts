// PURE chat-pipeline binding RULES — ZERO imports of db/IO, exhaustively unit-testable (mirrors
// pipelines-policy.ts / tenancy-policy.ts). These decide the GOVERNED chat binding for CONSUMERS-BIND
// (#166): most-specific-wins resolution + the admin "available for chat" SET gating. No DB, no network.
//
// The hardened model (docs/PIPELINES_AND_GATEWAYS_PLAN.md § Hardened model (A)):
//   • Admin sets the ORG DEFAULT chat pipeline + the SET of pipelines "available for chat".
//   • A user picks a per-project pipeline ONLY from that available set — no ungoverned binding.
//   • Resolution scopes, most-specific wins: per-project override → org default.
//
// The DB I/O lives in chat.ts / store.ts (the adapters). This file can never touch the network or DB.

// ─── the org chat-binding governance (read from org_settings) ──────────────────────────────────────
export interface ChatBindingGovernance {
  /** The org-default chat pipeline id (used when a project pins nothing). Null ⇒ ungoverned/off. */
  defaultChatPipelineId: string | null;
  /** The SET of pipeline ids a user may pick per-project. The default is implicitly always allowed. */
  allowlist: string[];
}

// ─── the project's own binding (read from chat_projects) ───────────────────────────────────────────
export interface ProjectBinding {
  /** The per-project pipeline override, or null to inherit the org default. */
  pipelineId: string | null;
}

/**
 * The effective set a user may pick from for a project's pipeline binding: the admin allowlist,
 * plus the org default (always implicitly allowed — you can always fall back to the governed default),
 * de-duplicated and stable-ordered (default first). Empty defaultChatPipelineId is not added.
 */
export function availableChatPipelines(gov: ChatBindingGovernance): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (!id) return;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  add(gov.defaultChatPipelineId);
  for (const id of gov.allowlist ?? []) add(id);
  return out;
}

/**
 * Is `pipelineId` a legal per-project pick under this governance? A user may only bind a pipeline in
 * the available set (allowlist ∪ {default}). `null` (inherit the default) is always legal. This is the
 * SERVER-SIDE gate — never trust a client-supplied pipeline id without running it through this.
 */
export function isChatPipelineAllowed(
  pipelineId: string | null | undefined,
  gov: ChatBindingGovernance,
): boolean {
  if (!pipelineId) return true; // null/empty ⇒ inherit the org default; always legal
  return availableChatPipelines(gov).includes(pipelineId);
}

/**
 * Resolve the pipeline a chat/project run executes on — MOST-SPECIFIC-WINS:
 *   1. the project's own override (project.pipelineId), if set AND still in the available set
 *      (a project can't retain a pipeline the admin has since removed from the set),
 *   2. else the org default (gov.defaultChatPipelineId),
 *   3. else null (no governed pipeline configured — caller falls back to the raw gateway path).
 *
 * Pure: takes the project binding + org governance, returns the resolved pipeline id (or null).
 */
export function resolveChatPipeline(
  project: ProjectBinding | null,
  gov: ChatBindingGovernance,
): string | null {
  const override = project?.pipelineId ?? null;
  if (override && isChatPipelineAllowed(override, gov)) return override;
  return gov.defaultChatPipelineId ?? null;
}

/**
 * Resolve the pipeline an APP/AGENT consumer run executes on — most-specific-wins: the consumer's
 * OWN binding (apps.pipeline_id), else the org default. Apps aren't allowlist-gated (an admin binds
 * them directly in the builder), so there is no set check here — just the two-level fallback. Pure.
 */
export function resolveConsumerPipeline(
  boundPipelineId: string | null | undefined,
  orgDefaultPipelineId: string | null | undefined,
): string | null {
  return boundPipelineId || orgDefaultPipelineId || null;
}

/** The canonical run tag for a resolved pipeline (`pipeline:<id>`), or null when none resolved. */
export function pipelineRunTag(pipelineId: string | null | undefined): string | null {
  return pipelineId ? `pipeline:${pipelineId}` : null;
}
