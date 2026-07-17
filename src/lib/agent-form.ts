// Pure, zero-IO rules for authoring/editing a custom agent. Shared by the create/edit panel
// (client validation + shaping the request body) and the admin routes (normalizing the untrusted
// body). No React, no DB — unit-testable in isolation. See test/agent-form.test.ts.

import { parseAgentPipelineId } from '@/lib/agent-pipeline-policy';

export const AGENT_TRIGGERS = [
  'on-demand',
  'on-call',
  'on-message',
  'observed',
  'scheduled',
] as const;

export type AgentTriggerValue = (typeof AGENT_TRIGGERS)[number];

export interface AgentFormInput {
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  model: string;
  tools: string[];
  grounded: boolean;
  trigger: AgentTriggerValue;
  pipelineId: string | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];

/** Coerce an arbitrary value to a valid trigger, falling back to 'on-demand'. */
export function normalizeTrigger(v: unknown): AgentTriggerValue {
  const s = str(v);
  return (AGENT_TRIGGERS as readonly string[]).includes(s) ? (s as AgentTriggerValue) : 'on-demand';
}

/** Validation messages for the required fields, keyed by field. Empty object = valid. */
export function validateAgentForm(input: { name?: unknown; systemPrompt?: unknown }): {
  name?: string;
  systemPrompt?: string;
} {
  const errors: { name?: string; systemPrompt?: string } = {};
  if (!str(input.name)) errors.name = 'A name is required.';
  if (!str(input.systemPrompt)) errors.systemPrompt = 'Instructions are required.';
  return errors;
}

/**
 * Normalize an untrusted body into full create-agent input, or null when a required field is
 * missing. Used by POST (create).
 */
export function parseCreateInput(b: Record<string, unknown> | null): AgentFormInput | null {
  const o = b ?? {};
  const name = str(o.name);
  const systemPrompt = str(o.systemPrompt);
  const pipeline = parseAgentPipelineId(o.pipelineId);
  if (!name || !systemPrompt || !pipeline.ok) return null;
  return {
    name,
    systemPrompt,
    role: str(o.role) || 'Custom',
    description: str(o.description),
    model: str(o.model),
    tools: strList(o.tools),
    grounded: o.grounded !== false,
    trigger: normalizeTrigger(o.trigger),
    pipelineId: pipeline.pipelineId,
  };
}

/**
 * Normalize an untrusted body into a partial edit patch: only keys actually present in the body
 * are included, so an edit that omits a field leaves it untouched. Required fields, when present,
 * must be non-empty — returns null if `name` or `systemPrompt` is present but blank.
 */
export function parseEditPatch(b: Record<string, unknown> | null): Partial<AgentFormInput> | null {
  const o = b ?? {};
  const patch: Partial<AgentFormInput> = {};
  if ('name' in o) {
    const name = str(o.name);
    if (!name) return null;
    patch.name = name;
  }
  if ('systemPrompt' in o) {
    const sp = str(o.systemPrompt);
    if (!sp) return null;
    patch.systemPrompt = sp;
  }
  if ('role' in o) patch.role = str(o.role) || 'Custom';
  if ('description' in o) patch.description = str(o.description);
  if ('model' in o) patch.model = str(o.model);
  if ('tools' in o) patch.tools = strList(o.tools);
  if ('grounded' in o) patch.grounded = o.grounded !== false;
  if ('trigger' in o) patch.trigger = normalizeTrigger(o.trigger);
  if ('pipelineId' in o) {
    const pipeline = parseAgentPipelineId(o.pipelineId);
    if (!pipeline.ok) return null;
    patch.pipelineId = pipeline.pipelineId;
  }
  return patch;
}
