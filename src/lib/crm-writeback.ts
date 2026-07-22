import { createHash } from 'node:crypto';
import type { ValidatedCrmOpportunityWriteback } from './crm-writeback-validation';

export {
  CRM_FOLLOW_UP_KINDS,
  CRM_OPPORTUNITY_STAGES,
  CRM_WRITEBACK_USE_CASES,
  validateCrmOpportunityWriteback,
  type CrmFollowUpKind,
  type CrmOpportunityStage,
  type CrmOpportunityWritebackInput,
  type CrmWritebackUseCase,
  type CrmWritebackValidationResult,
  type ValidatedCrmOpportunityWriteback,
} from './crm-writeback-validation';

// CRM write-back is deliberately an action contract, not generic REST mutation. Workflows may
// update an existing opportunity's next action (and, optionally, its stage), but they cannot pick
// arbitrary paths, HTTP verbs, or JSON fields. This is the shared bounded seam used by the bank
// cross-sell and lender-delinquency journeys.

export interface CrmOpportunityPatchContext {
  orgId: string;
  writtenAt: string;
}

export function crmCommandHash(input: ValidatedCrmOpportunityWriteback): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

// The only external fields this action may write. Tenant identity is derived server-side and
// embedded in the metadata, never accepted from the caller.
export function buildCrmOpportunityPatch(
  input: ValidatedCrmOpportunityWriteback,
  context: CrmOpportunityPatchContext,
): Record<string, unknown> {
  return {
    ...(input.stage ? { stage: input.stage } : {}),
    next_action: {
      kind: input.followUp.kind,
      summary: input.followUp.summary,
      ...(input.followUp.dueAt ? { due_at: input.followUp.dueAt } : {}),
      ...(input.followUp.assignee ? { assignee: input.followUp.assignee } : {}),
    },
    offgrid_writeback: {
      idempotency_key: input.idempotencyKey,
      command_hash: crmCommandHash(input),
      source_use_case: input.useCase,
      org_id: context.orgId,
      written_at: context.writtenAt,
    },
  };
}

export function isCrmWritebackReplay(
  record: Record<string, unknown>,
  orgId: string,
  idempotencyKey: string,
): boolean {
  const metadata = record.offgrid_writeback;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const value = metadata as Record<string, unknown>;
  return value.org_id === orgId && value.idempotency_key === idempotencyKey;
}

export function crmWritebackIdempotencyState(
  record: Record<string, unknown>,
  orgId: string,
  idempotencyKey: string,
  commandHash: string,
): 'new' | 'replay' | 'conflict' {
  const metadata = record.offgrid_writeback;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return 'new';
  const value = metadata as Record<string, unknown>;
  if (value.org_id !== orgId || value.idempotency_key !== idempotencyKey) return 'new';
  return value.command_hash === commandHash ? 'replay' : 'conflict';
}

export function crmRecordHash(record: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex');
}
