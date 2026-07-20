import { createHash } from 'node:crypto';
import { CRM_FOLLOW_UP_KINDS, CRM_WRITEBACK_USE_CASES, type CrmFollowUpKind, type CrmWritebackUseCase } from './crm-writeback';

export const CRM_TASK_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'] as const;
export type CrmTaskStatus = (typeof CRM_TASK_STATUSES)[number];

export interface CrmTaskCreateCommand {
  operation: 'create-task';
  idempotencyKey: string;
  subject: string;
  useCase: CrmWritebackUseCase;
  kind: CrmFollowUpKind;
  status?: CrmTaskStatus;
  opportunityId?: string;
  accountId?: string;
  dueAt?: string;
  assignee?: string;
}

export interface CrmTaskUpdateCommand {
  operation: 'update-task';
  taskId: string;
  idempotencyKey: string;
  patch: {
    subject?: string;
    status?: CrmTaskStatus;
    dueAt?: string | null;
    assignee?: string | null;
  };
}

export type CrmTaskCommand = CrmTaskCreateCommand | CrmTaskUpdateCommand;
export type CrmTaskValidationResult =
  | { ok: true; value: CrmTaskCommand }
  | { ok: false; errors: string[] };

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_TASK_ID = /^task_[a-f0-9]{16}$/;
const SAFE_KEY = /^[A-Za-z0-9._:-]{8,160}$/;

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  return clean && clean.length <= max ? clean : undefined;
}

function validTimestamp(value: string): boolean {
  return value.includes('T') && !Number.isNaN(Date.parse(value));
}

function unsupportedKeys(raw: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowlist = new Set(allowed);
  return Object.keys(raw).some((key) => !allowlist.has(key));
}

export function validateCrmTaskCommand(input: unknown): CrmTaskValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['body must be an object'] };
  }
  const raw = input as Record<string, unknown>;
  if (raw.operation !== 'create-task' && raw.operation !== 'update-task') {
    return { ok: false, errors: ['operation must be create-task or update-task'] };
  }
  const errors: string[] = [];
  const idempotencyKey = cleanString(raw.idempotencyKey, 160) ?? '';
  if (!SAFE_KEY.test(idempotencyKey)) errors.push('idempotencyKey must be 8-160 safe characters');

  if (raw.operation === 'create-task') {
    const allowed = ['operation', 'idempotencyKey', 'subject', 'useCase', 'kind', 'status', 'opportunityId', 'accountId', 'dueAt', 'assignee'];
    if (unsupportedKeys(raw, allowed)) errors.push('create-task contains unsupported fields');
    const subject = cleanString(raw.subject, 200);
    if (!subject) errors.push('subject must be 1-200 characters');
    const useCase = raw.useCase as CrmWritebackUseCase;
    if (!(CRM_WRITEBACK_USE_CASES as readonly unknown[]).includes(useCase)) errors.push(`useCase must be one of: ${CRM_WRITEBACK_USE_CASES.join(', ')}`);
    const kind = raw.kind as CrmFollowUpKind;
    if (!(CRM_FOLLOW_UP_KINDS as readonly unknown[]).includes(kind)) errors.push(`kind must be one of: ${CRM_FOLLOW_UP_KINDS.join(', ')}`);
    const status = (raw.status ?? 'open') as CrmTaskStatus;
    if (!(CRM_TASK_STATUSES as readonly unknown[]).includes(status)) errors.push(`status must be one of: ${CRM_TASK_STATUSES.join(', ')}`);
    const opportunityId = cleanString(raw.opportunityId, 128);
    const accountId = cleanString(raw.accountId, 128);
    if ((raw.opportunityId !== undefined && (!opportunityId || !SAFE_ID.test(opportunityId)))
      || (raw.accountId !== undefined && (!accountId || !SAFE_ID.test(accountId)))) errors.push('CRM relation ids must be safe identifiers');
    if (!opportunityId && !accountId) errors.push('opportunityId or accountId is required');
    const dueAt = cleanString(raw.dueAt, 64);
    if (raw.dueAt !== undefined && (!dueAt || !validTimestamp(dueAt))) errors.push('dueAt must be a valid ISO timestamp');
    const assignee = cleanString(raw.assignee, 120);
    if (raw.assignee !== undefined && !assignee) errors.push('assignee must be 1-120 characters');
    if (errors.length || !subject) return { ok: false, errors };
    return { ok: true, value: {
      operation: 'create-task', idempotencyKey, subject, useCase, kind, status,
      ...(opportunityId ? { opportunityId } : {}), ...(accountId ? { accountId } : {}),
      ...(dueAt ? { dueAt } : {}), ...(assignee ? { assignee } : {}),
    } };
  }

  if (unsupportedKeys(raw, ['operation', 'taskId', 'idempotencyKey', 'patch'])) errors.push('update-task contains unsupported fields');
  const taskId = cleanString(raw.taskId, 64) ?? '';
  if (!SAFE_TASK_ID.test(taskId)) errors.push('taskId must be a versioned CRM task id');
  if (!raw.patch || typeof raw.patch !== 'object' || Array.isArray(raw.patch)) errors.push('patch must be an object');
  const patchRaw = (raw.patch ?? {}) as Record<string, unknown>;
  if (unsupportedKeys(patchRaw, ['subject', 'status', 'dueAt', 'assignee'])) errors.push('patch contains unsupported fields');
  const patch: CrmTaskUpdateCommand['patch'] = {};
  if (patchRaw.subject !== undefined) {
    const subject = cleanString(patchRaw.subject, 200);
    if (!subject) errors.push('patch.subject must be 1-200 characters'); else patch.subject = subject;
  }
  if (patchRaw.status !== undefined) {
    if (!(CRM_TASK_STATUSES as readonly unknown[]).includes(patchRaw.status)) errors.push(`patch.status must be one of: ${CRM_TASK_STATUSES.join(', ')}`);
    else patch.status = patchRaw.status as CrmTaskStatus;
  }
  if (patchRaw.dueAt !== undefined) {
    if (patchRaw.dueAt === null) patch.dueAt = null;
    else {
      const dueAt = cleanString(patchRaw.dueAt, 64);
      if (!dueAt || !validTimestamp(dueAt)) errors.push('patch.dueAt must be null or a valid ISO timestamp'); else patch.dueAt = dueAt;
    }
  }
  if (patchRaw.assignee !== undefined) {
    if (patchRaw.assignee === null) patch.assignee = null;
    else {
      const assignee = cleanString(patchRaw.assignee, 120);
      if (!assignee) errors.push('patch.assignee must be null or 1-120 characters'); else patch.assignee = assignee;
    }
  }
  if (Object.keys(patch).length === 0) errors.push('patch must change at least one field');
  return errors.length ? { ok: false, errors } : { ok: true, value: { operation: 'update-task', taskId, idempotencyKey, patch } };
}

export function crmTaskCommandHash(command: CrmTaskCommand): string {
  return createHash('sha256').update(JSON.stringify(command)).digest('hex');
}

export function crmTaskHash(task: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(task)).digest('hex');
}

export function buildCrmTaskSourceRequest(command: CrmTaskCommand): {
  method: 'POST' | 'PATCH'; path: string[]; body: Record<string, unknown>;
} {
  if (command.operation === 'create-task') {
    const { operation: _operation, ...body } = command;
    return { method: 'POST', path: ['v1', 'tasks'], body };
  }
  return {
    method: 'PATCH', path: ['v1', 'tasks', command.taskId],
    body: { idempotencyKey: command.idempotencyKey, patch: command.patch },
  };
}
