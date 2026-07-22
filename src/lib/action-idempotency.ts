import { createHash } from 'node:crypto';
import { actionTarget, type ActionStepShape } from '@/lib/action-contract';

/**
 * Idempotency is runtime ownership, never a non-technical builder field. The same tenant/run/step
 * and target deterministically replay; a new run gets an independent command. The digest keeps the
 * key bounded and prevents target text from leaking into CRM metadata.
 */
export function deriveActionIdempotencyKey(
  step: ActionStepShape,
  context: { orgId: string; runId: string; stepId: string },
): string {
  const material = [
    context.orgId,
    context.runId,
    context.stepId,
    step.actionId,
    actionTarget(step.actionId, step.command),
  ].join('\u0000');
  return `action:${createHash('sha256').update(material).digest('hex')}`;
}

export function commandWithRuntimeIdempotency(
  step: ActionStepShape,
  context: { orgId: string; runId: string; stepId: string },
): Record<string, unknown> {
  const command = { ...step.command, idempotencyKey: deriveActionIdempotencyKey(step, context) };
  if (step.actionId === 'crm.create-task') return { ...command, operation: 'create-task' };
  if (step.actionId === 'crm.update-task') return { ...command, operation: 'update-task' };
  const { operation: _operation, ...opportunity } = command;
  return opportunity;
}
