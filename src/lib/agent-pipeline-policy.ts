// PURE agent-to-pipeline binding rules — zero DB/network imports.
//
// An agent is an independently managed consumer. Its pipeline binding is therefore explicit:
// `custom_agents.pipeline_id` either names the governing pipeline or is null. It must never inherit
// the chat default, because changing chat governance must not silently change an agent's runtime
// contract. The I/O adapters validate/load the returned id within the caller's org.

export interface ParsedAgentPipelineId {
  ok: boolean;
  pipelineId: string | null;
}

/** Parse an untrusted create/edit field. Null/blank means deliberately unbound; non-strings reject. */
export function parseAgentPipelineId(value: unknown): ParsedAgentPipelineId {
  if (value === null || value === undefined) return { ok: true, pipelineId: null };
  if (typeof value !== 'string') return { ok: false, pipelineId: null };
  return { ok: true, pipelineId: value.trim() || null };
}

/** Resolve an agent's effective binding. There is intentionally no org/chat-default fallback. */
export function resolveAgentPipeline(
  boundPipelineId: string | null | undefined,
): string | null {
  return parseAgentPipelineId(boundPipelineId).pipelineId;
}
