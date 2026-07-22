// Governed Action Plane — PURE contract, descriptor catalogue, impact planning and approval policy.
//
// This is the one generic action vocabulary consumed by Apps. Concrete transports remain behind
// adapters; the first implementations reuse the existing bounded CRM task/opportunity adapters.
// Future Kestra/catalog actions extend this catalogue and adapter dispatch instead of creating a
// parallel registry or exposing arbitrary URLs, methods, and payloads to an App.

import { validateCrmTaskCommand } from '@/lib/crm-task-writeback';
import { validateCrmOpportunityWriteback } from '@/lib/crm-writeback';

export const ACTION_DESCRIPTORS = {
  'crm.create-task': {
    id: 'crm.create-task',
    label: 'Create CRM follow-up task',
    system: 'CRM',
    effect: 'create' as const,
    approval: 'maker-checker' as const,
    egress: 'on-prem-enterprise' as const,
  },
  'crm.update-task': {
    id: 'crm.update-task',
    label: 'Update CRM follow-up task',
    system: 'CRM',
    effect: 'update' as const,
    approval: 'maker-checker' as const,
    egress: 'on-prem-enterprise' as const,
  },
  'crm.update-opportunity': {
    id: 'crm.update-opportunity',
    label: 'Update CRM opportunity',
    system: 'CRM',
    effect: 'update' as const,
    approval: 'maker-checker' as const,
    egress: 'on-prem-enterprise' as const,
  },
} as const;

export type ActionId = keyof typeof ACTION_DESCRIPTORS;
export type ActionDescriptor = (typeof ACTION_DESCRIPTORS)[ActionId];

export function defaultActionCommand(actionId: ActionId): Record<string, unknown> {
  if (actionId === 'crm.create-task') {
    return { subject: '', useCase: '', kind: '', opportunityId: '' };
  }
  if (actionId === 'crm.update-task') return { taskId: '', patch: {} };
  return { opportunityId: '', useCase: '', followUp: { kind: '', summary: '' } };
}

export interface ActionStepShape {
  id: string;
  kind: 'action';
  actionId: ActionId;
  connectorId: string;
  command: Record<string, unknown>;
  /** The exact human step whose approved decision authorizes this mutation. */
  approvalStepId?: string;
}

export interface ActionImpact {
  actionId: ActionId;
  label: string;
  system: string;
  effect: 'create' | 'update';
  target: string;
  summary: string;
  approval: {
    required: boolean;
    stepId?: string;
    status: 'required' | 'approved' | 'not-required';
  };
  egress: {
    classification: 'internal-connection-required' | 'on-prem-enterprise';
    dataLeavesOrganisation: false | null;
    dlp: 'boundary-verification-required' | 'not-applicable-on-prem';
  };
  sideEffects: string[];
}

export interface ActionReceipt {
  actionId: ActionId;
  label: string;
  system: string;
  orgId: string;
  runId: string;
  stepId: string;
  connectorId: string;
  target: string;
  idempotencyKey: string;
  status: 'executed' | 'replayed';
  executedAt: string;
  approval: {
    stepId: string;
    evidence: string;
    /** Current resume records do not persist reviewer identity; omitted rather than fabricated. */
    reviewer?: string;
  };
  /** The existing domain adapter's signed, versioned receipt. */
  providerReceipt: Record<string, unknown>;
}

export interface ActionApprovalEvidence {
  stepId: string;
  kind: string;
  status: string;
  detail?: string;
  reviewer?: string;
}

export interface ActionValidationResult {
  ok: boolean;
  errors: string[];
}

const SAFE_CONNECTOR_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isActionId(value: unknown): value is ActionId {
  return typeof value === 'string' && value in ACTION_DESCRIPTORS;
}

export function getActionDescriptor(actionId: ActionId): ActionDescriptor {
  return ACTION_DESCRIPTORS[actionId];
}

/** Validate only the generic envelope; the owning CRM adapter validates the bounded command. */
export function validateActionEnvelope(step: ActionStepShape): ActionValidationResult {
  const errors: string[] = [];
  if (!isActionId(step.actionId)) errors.push(`action step ${step.id}: unknown action`);
  if (!SAFE_CONNECTOR_ID.test(step.connectorId ?? '')) {
    errors.push(`action step ${step.id}: needs a safe connector binding`);
  }
  if (!step.command || typeof step.command !== 'object' || Array.isArray(step.command)) {
    errors.push(`action step ${step.id}: command must be an object`);
  }
  if (isActionId(step.actionId)) {
    const descriptor = getActionDescriptor(step.actionId);
    if (descriptor.approval === 'maker-checker' && !step.approvalStepId?.trim()) {
      errors.push(`action step ${step.id}: needs a maker-checker approval step`);
    }
  }
  return { ok: errors.length === 0, errors };
}

const READINESS_KEY = 'action:0000000000000000000000000000000000000000000000000000000000000000';

/**
 * The canonical save/readiness validator. It reuses the existing bounded CRM validators after
 * injecting runtime-owned operation/idempotency fields, so UI and AppSpec validation report the
 * same target/title/type/purpose gaps without duplicating domain rules.
 */
export function validateActionCommandReadiness(step: ActionStepShape): ActionValidationResult {
  if (!isActionId(step.actionId)) return { ok: false, errors: [] };
  const command = { ...step.command, idempotencyKey: READINESS_KEY };
  const result =
    step.actionId === 'crm.create-task'
      ? validateCrmTaskCommand({ ...command, operation: 'create-task' })
      : step.actionId === 'crm.update-task'
        ? validateCrmTaskCommand({ ...command, operation: 'update-task' })
        : validateCrmOpportunityWriteback(command);
  const errors = result.ok ? [] : result.errors.map((error) => `action step ${step.id}: ${error}`);
  return { ok: errors.length === 0, errors };
}

export function actionTarget(actionId: ActionId, command: Record<string, unknown>): string {
  if (actionId === 'crm.create-task') {
    return cleanActionTarget([command.opportunityId, command.accountId], 'selected CRM record');
  }
  if (actionId === 'crm.update-task') {
    return cleanActionTarget([command.taskId], 'selected CRM task');
  }
  return cleanActionTarget([command.opportunityId], 'selected CRM opportunity');
}

function cleanActionTarget(values: unknown[], fallback: string): string {
  for (const value of values) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const clean = String(value).trim();
    if (clean) return clean;
  }
  return fallback;
}

/** Plain-language, bounded, PII-minimising preview. Free-text command fields are never echoed. */
export function planActionImpact(step: ActionStepShape, approved = false): ActionImpact {
  const descriptor = getActionDescriptor(step.actionId);
  const target = actionTarget(step.actionId, step.command).slice(0, 128);
  const required = descriptor.approval === 'maker-checker';
  return {
    actionId: step.actionId,
    label: descriptor.label,
    system: descriptor.system,
    effect: descriptor.effect,
    target,
    summary: `${descriptor.label} for ${target}. Nothing has been changed.`,
    approval: {
      required,
      ...(step.approvalStepId ? { stepId: step.approvalStepId } : {}),
      status: required ? (approved ? 'approved' : 'required') : 'not-required',
    },
    egress: {
      classification: 'internal-connection-required',
      dataLeavesOrganisation: null,
      dlp: 'boundary-verification-required',
    },
    sideEffects: [
      descriptor.effect === 'create'
        ? `Creates one record in ${descriptor.system}`
        : `Updates one allowlisted record in ${descriptor.system}`,
    ],
  };
}

/** Apply only after the resolved connector passed the internal-enterprise endpoint rule. */
export function confirmOnPremActionImpact(impact: ActionImpact): ActionImpact {
  return {
    ...impact,
    egress: {
      classification: 'on-prem-enterprise',
      dataLeavesOrganisation: false,
      dlp: 'not-applicable-on-prem',
    },
  };
}

export function hasApprovedMakerChecker(
  step: ActionStepShape,
  priorResults: ActionApprovalEvidence[],
): boolean {
  const descriptor = getActionDescriptor(step.actionId);
  if (descriptor.approval !== 'maker-checker') return true;
  if (!step.approvalStepId) return false;
  const approval = priorResults.find((result) => result.stepId === step.approvalStepId);
  return approvalEvidenceMatches(step, approval);
}

/** The one exact-step + approved-evidence rule used by runtime and every concrete adapter. */
export function approvalEvidenceMatches(
  step: ActionStepShape,
  approval: ActionApprovalEvidence | undefined,
): boolean {
  return Boolean(
    step.approvalStepId &&
    approval &&
    approval.stepId === step.approvalStepId &&
    approval.kind === 'human' &&
    approval.status === 'done' &&
    /\bapproved\b/i.test(approval.detail ?? ''),
  );
}

/** Graph policy: the named checker must be a human ancestor, never a sibling or later step. */
export function isApprovalAncestor(
  stepId: string,
  approvalStepId: string,
  steps: readonly { id: string; kind: string }[],
  edges: readonly { from: string; to: string }[],
): boolean {
  if (steps.find((step) => step.id === approvalStepId)?.kind !== 'human') return false;
  const predecessors = new Map<string, string[]>();
  for (const edge of edges) {
    const prior = predecessors.get(edge.to) ?? [];
    prior.push(edge.from);
    predecessors.set(edge.to, prior);
  }
  const seen = new Set<string>();
  const queue = [...(predecessors.get(stepId) ?? [])];
  while (queue.length) {
    const candidate = queue.shift()!;
    if (candidate === approvalStepId) return true;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    queue.push(...(predecessors.get(candidate) ?? []));
  }
  return false;
}
