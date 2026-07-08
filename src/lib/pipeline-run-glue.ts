// I/O glue that RESOLVES the enforceable pipeline contract for the two run paths PA-16b gates — the
// AGENT run (runAgent) and the CHAT run (chat stream) — reusing the ALREADY-BUILT seam:
//   • the PURE binding resolution — resolveConsumerPipeline / resolveChatPipeline (chat-pipeline-policy)
//   • the CONTRACT resolver — resolveContract (pipeline-contract.ts, the DB adapter)
//
// It duplicates NEITHER the enforcement decisions (pipeline-enforcement.ts) NOR the contract loader
// (pipeline-contract.ts) — it only bridges "which pipeline is bound for THIS consumer?" (a pure
// most-specific-wins decision) to "load its contract" (the existing adapter). The run paths then call
// the pure enforceDataAccess / enforceModelCall exactly as app-run.ts does (PA-16 reference).
//
// SOLID: thin adapter. The pure decisions live in chat-pipeline-policy.ts; the DB I/O lives in
// pipeline-contract.ts / store.ts / chat.ts. This module only wires them together per consumer type.

import { resolveChatPipeline, resolveConsumerPipeline } from '@/lib/chat-pipeline-policy';
import { resolveContract } from '@/lib/pipeline-contract';
import type { PipelineContract } from '@/lib/pipeline-enforcement';

/** A resolved binding: which pipeline (if any) governs this run, and its enforceable contract. */
export interface ResolvedPipelineBinding {
  /** The resolved pipeline id (most-specific-wins), or null when nothing is bound. */
  pipelineId: string | null;
  /** The enforceable contract (null ⇒ legacy behaviour — the ADDITIVE guarantee). */
  contract: PipelineContract | null;
}

/**
 * Resolve the contract that governs an AGENT run. Most-specific-wins: the agent's own binding (when a
 * per-agent pipeline binding exists) else the org-default chat/consumer pipeline. Delegates the pure
 * two-level fallback to resolveConsumerPipeline and the load to resolveContract (never throws — a
 * missing/unresolvable pipeline degrades to a null contract = legacy behaviour).
 */
export async function resolveAgentBinding(
  agentPipelineId: string | null | undefined,
  orgDefaultPipelineId: string | null | undefined,
  orgId: string,
): Promise<ResolvedPipelineBinding> {
  const pipelineId = resolveConsumerPipeline(agentPipelineId, orgDefaultPipelineId);
  const contract = await resolveContract(pipelineId, orgId);
  return { pipelineId, contract };
}

/**
 * Resolve the contract that governs a CHAT run for a given project. Reads the project's binding + the
 * org chat-binding governance via the injected I/O, runs the PURE resolveChatPipeline (per-project
 * override → org default, allowlist-gated), then loads the contract. The two reads are injected so
 * this is unit-testable without the DB; production wires the real store functions in
 * defaultChatBindingIO.
 */
export interface ChatBindingIO {
  getProjectBinding: (projectId: string | null) => Promise<{ pipelineId: string | null } | null>;
  getChatBindingGovernance: () => Promise<{ defaultChatPipelineId: string | null; allowlist: string[] }>;
}

export function defaultChatBindingIO(): ChatBindingIO {
  return {
    async getProjectBinding(projectId) {
      const { getProjectBinding } = await import('@/lib/chat');
      return getProjectBinding(projectId);
    },
    async getChatBindingGovernance() {
      const { getChatBindingGovernance } = await import('@/lib/store');
      return getChatBindingGovernance();
    },
  };
}

export async function resolveChatBinding(
  projectId: string | null,
  orgId: string,
  io: ChatBindingIO = defaultChatBindingIO(),
): Promise<ResolvedPipelineBinding> {
  const [binding, gov] = await Promise.all([
    io.getProjectBinding(projectId),
    io.getChatBindingGovernance(),
  ]);
  const pipelineId = resolveChatPipeline(binding, gov);
  const contract = await resolveContract(pipelineId, orgId);
  return { pipelineId, contract };
}
