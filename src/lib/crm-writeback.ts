import { createHash } from 'node:crypto';

// CRM write-back is deliberately an action contract, not generic REST mutation. Workflows may
// update an existing opportunity's next action (and, optionally, its stage), but they cannot pick
// arbitrary paths, HTTP verbs, or JSON fields. This is the shared bounded seam used by the bank
// cross-sell and lender-delinquency journeys.

export const CRM_WRITEBACK_USE_CASES = ['bank-cross-sell', 'lender-delinquency'] as const;
export const CRM_FOLLOW_UP_KINDS = ['call', 'email', 'meeting', 'review'] as const;
export const CRM_OPPORTUNITY_STAGES = [
  'discovery',
  'qualification',
  'proposal',
  'negotiation',
  'closed_won',
  'closed_lost',
] as const;

export type CrmWritebackUseCase = (typeof CRM_WRITEBACK_USE_CASES)[number];
export type CrmFollowUpKind = (typeof CRM_FOLLOW_UP_KINDS)[number];
export type CrmOpportunityStage = (typeof CRM_OPPORTUNITY_STAGES)[number];

export interface CrmOpportunityWritebackInput {
  opportunityId: string | number;
  idempotencyKey: string;
  useCase: CrmWritebackUseCase;
  followUp: {
    kind: CrmFollowUpKind;
    summary: string;
    dueAt?: string;
    assignee?: string;
  };
  stage?: CrmOpportunityStage;
}

export interface ValidatedCrmOpportunityWriteback {
  opportunityId: string;
  idempotencyKey: string;
  useCase: CrmWritebackUseCase;
  followUp: {
    kind: CrmFollowUpKind;
    summary: string;
    dueAt?: string;
    assignee?: string;
  };
  stage?: CrmOpportunityStage;
}

export interface CrmWritebackValidationResult {
  ok: boolean;
  errors: string[];
  value?: ValidatedCrmOpportunityWriteback;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

function cleanOptional(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  return clean && clean.length <= max ? clean : undefined;
}

export function validateCrmOpportunityWriteback(
  input: unknown,
): CrmWritebackValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['body must be an object'] };
  }
  const raw = input as Record<string, unknown>;
  const followUpRaw = raw.followUp;
  const errors: string[] = [];

  const opportunityId = String(raw.opportunityId ?? '').trim();
  if (!SAFE_ID.test(opportunityId)) errors.push('opportunityId must be a safe CRM record id');

  const idempotencyKey = typeof raw.idempotencyKey === 'string' ? raw.idempotencyKey.trim() : '';
  if (!SAFE_IDEMPOTENCY_KEY.test(idempotencyKey)) {
    errors.push('idempotencyKey must be 8-128 letters, numbers, dot, colon, underscore, or dash');
  }

  const useCase = raw.useCase as CrmWritebackUseCase;
  if (!(CRM_WRITEBACK_USE_CASES as readonly unknown[]).includes(useCase)) {
    errors.push(`useCase must be one of: ${CRM_WRITEBACK_USE_CASES.join(', ')}`);
  }

  if (!followUpRaw || typeof followUpRaw !== 'object' || Array.isArray(followUpRaw)) {
    errors.push('followUp must be an object');
  }
  const followUp = (followUpRaw ?? {}) as Record<string, unknown>;
  const kind = followUp.kind as CrmFollowUpKind;
  if (!(CRM_FOLLOW_UP_KINDS as readonly unknown[]).includes(kind)) {
    errors.push(`followUp.kind must be one of: ${CRM_FOLLOW_UP_KINDS.join(', ')}`);
  }
  const summary = typeof followUp.summary === 'string' ? followUp.summary.trim() : '';
  if (!summary || summary.length > 240) errors.push('followUp.summary must be 1-240 characters');

  const dueAt = cleanOptional(followUp.dueAt, 64);
  if (followUp.dueAt !== undefined && !dueAt) {
    errors.push('followUp.dueAt must be a non-empty ISO timestamp of at most 64 characters');
  } else if (dueAt && Number.isNaN(Date.parse(dueAt))) {
    errors.push('followUp.dueAt must be a valid ISO timestamp');
  }

  const assignee = cleanOptional(followUp.assignee, 120);
  if (followUp.assignee !== undefined && !assignee) {
    errors.push('followUp.assignee must be 1-120 characters');
  }

  const stage = raw.stage as CrmOpportunityStage | undefined;
  if (stage !== undefined && !(CRM_OPPORTUNITY_STAGES as readonly unknown[]).includes(stage)) {
    errors.push(`stage must be one of: ${CRM_OPPORTUNITY_STAGES.join(', ')}`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    value: {
      opportunityId,
      idempotencyKey,
      useCase,
      followUp: {
        kind,
        summary,
        ...(dueAt ? { dueAt } : {}),
        ...(assignee ? { assignee } : {}),
      },
      ...(stage ? { stage } : {}),
    },
  };
}

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
