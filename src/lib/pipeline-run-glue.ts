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

import { resolveAgentPipeline } from '@/lib/agent-pipeline-policy';
import { resolveChatPipeline } from '@/lib/chat-pipeline-policy';
import { resolveContract } from '@/lib/pipeline-contract';
import type { PipelineContract } from '@/lib/pipeline-enforcement';
import { isConsumable } from '@/lib/pipeline-lifecycle-model';
import { getPipeline } from '@/lib/pipelines';

/**
 * The ONE agent-binding contract used by request dispatch and the Temporal worker. `contract:null`
 * is never ambiguous: it is valid only for a deliberately unbound agent. An explicit id that
 * cannot produce a published contract is invalid; infrastructure failure is unavailable. Both
 * terminal states fail closed before any durable submit, retrieval, connector, or model work.
 */
export type AgentPipelineBinding =
  | { state: 'unbound'; pipelineId: null; contract: null }
  | { state: 'bound'; pipelineId: string; contract: PipelineContract }
  | {
      state: 'invalid';
      pipelineId: string | null;
      contract: null;
      reason: string;
      code: 'agent_not_found' | 'pipeline_unavailable' | 'binding_changed';
    }
  | {
      state: 'unavailable';
      pipelineId: string | null;
      contract: null;
      reason: string;
      code: 'resolver_unavailable';
    };

/** Chat retains its separate inheritance semantics; null here still means no effective chat binding. */
export interface ResolvedChatPipelineBinding {
  pipelineId: string | null;
  contract: PipelineContract | null;
}

/** Generic explicit-consumer binding failure (apps and future governed consumers). */
export class PipelineBindingError extends Error {
  readonly binding: Extract<AgentPipelineBinding, { state: 'invalid' | 'unavailable' }>;

  constructor(binding: Extract<AgentPipelineBinding, { state: 'invalid' | 'unavailable' }>) {
    super(binding.reason);
    this.name = 'PipelineBindingError';
    this.binding = binding;
  }
}

/** Agent-specific error name retained for direct-agent API compatibility. */
export class AgentPipelineBindingError extends PipelineBindingError {
  constructor(binding: Extract<AgentPipelineBinding, { state: 'invalid' | 'unavailable' }>) {
    super(binding);
    this.name = 'AgentPipelineBindingError';
  }
}

/** Narrow an explicit consumer binding to the only states permitted to execute. */
export function requireRunnablePipelineBinding(
  binding: AgentPipelineBinding,
): Extract<AgentPipelineBinding, { state: 'bound' | 'unbound' }> {
  if (binding.state === 'bound' || binding.state === 'unbound') return binding;
  throw new PipelineBindingError(binding);
}

/** Narrow a resolved binding to the only two states permitted to execute. */
export function requireRunnableAgentBinding(
  binding: AgentPipelineBinding,
): Extract<AgentPipelineBinding, { state: 'bound' | 'unbound' }> {
  if (binding.state === 'bound' || binding.state === 'unbound') return binding;
  throw new AgentPipelineBindingError(binding);
}

/**
 * Resolve the contract that governs an AGENT run. Agent bindings are explicit: null means no
 * contract, never "inherit chat default". The contract loader is injectable at the external DB
 * boundary so tests can prove the org scope passed to it without replacing our decision code.
 */
export type PipelineContractResolver = (
  pipelineId: string | null | undefined,
  orgId: string,
) => Promise<PipelineContract | null>;

export async function resolveExplicitPipelineBinding(
  consumerPipelineId: string | null | undefined,
  orgId: string,
  loadContract: PipelineContractResolver = resolveContract,
): Promise<AgentPipelineBinding> {
  const pipelineId = resolveAgentPipeline(consumerPipelineId);
  if (!pipelineId) return { state: 'unbound', pipelineId: null, contract: null };
  try {
    const contract = await loadContract(pipelineId, orgId);
    if (!contract || contract.pipelineId !== pipelineId) {
      return {
        state: 'invalid',
        pipelineId,
        contract: null,
        code: 'pipeline_unavailable',
        reason: `Agent binding is invalid: pipeline '${pipelineId}' is missing or not published.`,
      };
    }
    return { state: 'bound', pipelineId, contract };
  } catch {
    return {
      state: 'unavailable',
      pipelineId,
      contract: null,
      code: 'resolver_unavailable',
      reason: `Agent binding resolver is unavailable for pipeline '${pipelineId}'.`,
    };
  }
}

/** Agent-specific public name retained for callers; semantics are the shared explicit binding rule. */
export function resolveAgentBinding(
  agentPipelineId: string | null | undefined,
  orgId: string,
  loadContract: PipelineContractResolver = resolveContract,
): Promise<AgentPipelineBinding> {
  return resolveExplicitPipelineBinding(agentPipelineId, orgId, loadContract);
}

export type AgentDefinitionLookup = (
  agentId: string,
  orgId: string,
) => Promise<{ pipelineId?: string | null } | undefined>;

async function defaultAgentDefinitionLookup(agentId: string, orgId: string) {
  const { resolveAgent } = await import('@/lib/agents');
  return resolveAgent(agentId, orgId);
}

/** Resolve an agent row/definition and then its explicit binding without ever treating lookup failure as unbound. */
export async function resolveAgentRunBinding(
  agentId: string,
  orgId: string,
  lookupAgent: AgentDefinitionLookup = defaultAgentDefinitionLookup,
  loadContract: PipelineContractResolver = resolveContract,
): Promise<AgentPipelineBinding> {
  let agent: Awaited<ReturnType<AgentDefinitionLookup>>;
  try {
    agent = await lookupAgent(agentId, orgId);
  } catch {
    return {
      state: 'unavailable',
      pipelineId: null,
      contract: null,
      code: 'resolver_unavailable',
      reason: `Agent binding resolver is unavailable for agent '${agentId}'.`,
    };
  }
  if (!agent) {
    return {
      state: 'invalid',
      pipelineId: null,
      contract: null,
      code: 'agent_not_found',
      reason: `Unknown or disabled agent '${agentId}'.`,
    };
  }
  return resolveAgentBinding(agent.pipelineId, orgId, loadContract);
}

export type AgentPipelineLookup = typeof getPipeline;

/** Validate a persisted/requested agent binding inside the caller's org. Null is deliberately valid. */
export async function isAgentPipelineBindingValid(
  pipelineId: string | null,
  orgId: string,
  lookup: AgentPipelineLookup = getPipeline,
): Promise<boolean> {
  if (!pipelineId) return true;
  const pipeline = await lookup(pipelineId, orgId);
  return pipeline !== null && isConsumable(pipeline.status);
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
  // Tenant-scoped (SECURITY WAVE 1): the org chat-binding governance is now read PER-ORG, so the
  // resolver takes the caller's org and never reads another tenant's default/allowlist.
  getChatBindingGovernance: (
    orgId: string,
  ) => Promise<{ defaultChatPipelineId: string | null; allowlist: string[] }>;
}

export function defaultChatBindingIO(): ChatBindingIO {
  return {
    async getProjectBinding(projectId) {
      const { getProjectBinding } = await import('@/lib/chat');
      return getProjectBinding(projectId);
    },
    async getChatBindingGovernance(orgId) {
      const { getChatBindingGovernance } = await import('@/lib/store');
      return getChatBindingGovernance(orgId);
    },
  };
}

export async function resolveChatBinding(
  projectId: string | null,
  orgId: string,
  io: ChatBindingIO = defaultChatBindingIO(),
): Promise<ResolvedChatPipelineBinding> {
  const [binding, gov] = await Promise.all([
    io.getProjectBinding(projectId),
    io.getChatBindingGovernance(orgId),
  ]);
  const pipelineId = resolveChatPipeline(binding, gov);
  const contract = await resolveContract(pipelineId, orgId);
  return { pipelineId, contract };
}
