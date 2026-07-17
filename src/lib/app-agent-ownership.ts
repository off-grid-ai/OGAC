// Canonical AppSpec → runtime-agent ownership seam.
//
// A user-authored agent is a one-step AppSpec. Inline agent steps are materialized into custom-agent
// rows only so the existing governed executor can run them. Those rows must follow the owning app's
// binding and lifecycle; they are not a second authoring model.

import type { AppSpec } from '@/lib/app-model';
import { deleteCustomAgent, updateCustomAgent } from '@/lib/store';

export function materializedAgentIds(spec: AppSpec): string[] {
  return spec.steps.flatMap((step) =>
    step.kind === 'agent' && step.inlineAgent && step.agentId ? [step.agentId] : [],
  );
}

export async function syncMaterializedAgentOwnership(
  previous: AppSpec,
  next: AppSpec,
  orgId: string,
): Promise<void> {
  const previousIds = new Set(materializedAgentIds(previous));
  const nextIds = new Set(materializedAgentIds(next));

  await Promise.all([
    ...[...nextIds].map((id) =>
      updateCustomAgent(id, { pipelineId: next.pipelineId ?? null }, orgId),
    ),
    ...[...previousIds].filter((id) => !nextIds.has(id)).map((id) => deleteCustomAgent(id, orgId)),
  ]);
}

export async function deleteMaterializedAgents(spec: AppSpec, orgId: string): Promise<void> {
  await Promise.all(materializedAgentIds(spec).map((id) => deleteCustomAgent(id, orgId)));
}
