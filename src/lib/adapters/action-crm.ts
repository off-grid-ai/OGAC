// CRM implementation of the generic Governed Action Plane.
//
// This is intentionally a thin dispatcher over the existing bounded, tenant-scoped and idempotent
// CRM task/opportunity adapters. It does not invent a second REST client or accept arbitrary paths,
// methods or patches. The generic receipt wraps (and retains) the domain adapter's signed receipt.

import {
  approvalEvidenceMatches,
  actionTarget,
  getActionDescriptor,
  planActionImpact,
  validateActionEnvelope,
  type ActionImpact,
  type ActionReceipt,
  type ActionStepShape,
} from '@/lib/action-contract';
import {
  commandWithRuntimeIdempotency,
  deriveActionIdempotencyKey,
} from '@/lib/action-idempotency';
import type { ConnectorTarget } from '@/lib/connector-exec';
import { writeCrmTask } from '@/lib/adapters/crm-task-writeback';
import {
  writeCrmOpportunityFollowUp,
  type CrmWritebackErrorCode,
} from '@/lib/adapters/crm-writeback';

export type ActionExecutionErrorCode =
  CrmWritebackErrorCode | 'approval-required' | 'unsupported-action';

export interface ActionExecutionContext {
  orgId: string;
  runId: string;
  stepId: string;
  approval?: {
    stepId: string;
    evidence: string;
    reviewer?: string;
  };
  now?: () => Date;
}

export type ActionExecutionResult =
  | {
      ok: true;
      impact: ActionImpact;
      receipt: ActionReceipt;
      resource: Record<string, unknown>;
    }
  | {
      ok: false;
      code: ActionExecutionErrorCode;
      message: string;
      impact?: ActionImpact;
    };

export async function executeCrmAction(
  connector: ConnectorTarget,
  step: ActionStepShape,
  context: ActionExecutionContext,
): Promise<ActionExecutionResult> {
  const envelope = validateActionEnvelope(step);
  // An unknown action cannot be passed to planActionImpact/getActionDescriptor safely. This branch
  // is defensive for raw API/runtime input that bypassed AppSpec validation. Do not fabricate an
  // impact for a catalogue entry that does not exist.
  if (!envelope.ok && envelope.errors.some((error) => error.includes('unknown action'))) {
    return {
      ok: false,
      code: 'unsupported-action',
      message: 'This action is not available in the governed catalogue.',
    };
  }

  const approvalVerified = approvalEvidenceMatches(
    step,
    context.approval
      ? {
          stepId: context.approval.stepId,
          kind: 'human',
          status: 'done',
          detail: context.approval.evidence,
        }
      : undefined,
  );
  const impact = planActionImpact(step, approvalVerified);
  if (!envelope.ok) {
    return {
      ok: false,
      code: 'invalid-command',
      message: envelope.errors.join(' '),
      impact,
    };
  }
  if (!approvalVerified || !context.approval) {
    return {
      ok: false,
      code: 'approval-required',
      message: 'A different person must approve this action before it can change CRM.',
      impact,
    };
  }

  const clock = context.now ?? (() => new Date());
  // Non-technical builders never own replay semantics. Override any supplied key at the final
  // boundary so a malicious/stale AppSpec cannot replay another run's action.
  const command = commandWithRuntimeIdempotency(step, context);
  const result =
    step.actionId === 'crm.create-task' || step.actionId === 'crm.update-task'
      ? await writeCrmTask(connector, command, context.orgId, clock)
      : await writeCrmOpportunityFollowUp(connector, command, context.orgId, clock);
  if (!result.ok) return { ...result, impact };

  const descriptor = getActionDescriptor(step.actionId);
  const providerReceipt = result.receipt as unknown as Record<string, unknown>;
  const receipt: ActionReceipt = {
    actionId: step.actionId,
    label: descriptor.label,
    system: descriptor.system,
    orgId: context.orgId,
    runId: context.runId,
    stepId: context.stepId,
    connectorId: connector.id ?? step.connectorId,
    target: actionTarget(step.actionId, step.command),
    idempotencyKey: deriveActionIdempotencyKey(step, context),
    status: result.receipt.replayed ? 'replayed' : 'executed',
    executedAt: result.receipt.signedAt,
    approval: context.approval,
    providerReceipt,
  };
  const resource = 'task' in result ? result.task : result.record;
  return { ok: true, impact, receipt, resource };
}
