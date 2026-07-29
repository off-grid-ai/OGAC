// Canonical AppSpec → runtime-agent ownership seam.
//
// A user-authored agent is a one-step AppSpec. Inline agent steps are materialized into custom-agent
// rows only so the existing governed executor can run them. Those rows must follow the owning app's
// binding and lifecycle; they are not a second authoring model.

import type { AppSpec, AppStep } from '@/lib/app-model';

/** A materialized step: the runtime-agent row it owns, and the instructions that row must carry. */
export interface MaterializedAgentBinding {
  agentId: string;
  stepId: string;
  inlineAgent: NonNullable<Extract<AppStep, { kind: 'agent' }>['inlineAgent']>;
}

/**
 * Every step whose instructions live in a runtime-agent row this app owns.
 *
 * This is the list that has to be kept in step with the spec on save. It was only ever read for its ids,
 * so an edited step description was written to the App row and never to the agent row that actually runs —
 * the app kept its original behaviour and the edit looked like it had taken. Returning the binding, not
 * just the id, is what lets the caller re-sync the instructions.
 */
export function materializedAgentBindings(spec: AppSpec): MaterializedAgentBinding[] {
  return spec.steps.flatMap((step) =>
    step.kind === 'agent' && step.inlineAgent && step.agentId
      ? [{ agentId: step.agentId, stepId: step.id, inlineAgent: step.inlineAgent }]
      : [],
  );
}

export function materializedAgentIds(spec: AppSpec): string[] {
  return materializedAgentBindings(spec).map((binding) => binding.agentId);
}
