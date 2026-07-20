// Canonical AppSpec → runtime-agent ownership seam.
//
// A user-authored agent is a one-step AppSpec. Inline agent steps are materialized into custom-agent
// rows only so the existing governed executor can run them. Those rows must follow the owning app's
// binding and lifecycle; they are not a second authoring model.

import type { AppSpec } from '@/lib/app-model';

export function materializedAgentIds(spec: AppSpec): string[] {
  return spec.steps.flatMap((step) =>
    step.kind === 'agent' && step.inlineAgent && step.agentId ? [step.agentId] : [],
  );
}
