import { createHash } from 'node:crypto';
import type { CrmTaskCommand } from './crm-writeback-validation';

export {
  CRM_TASK_STATUSES,
  validateCrmTaskCommand,
  type CrmTaskCommand,
  type CrmTaskCreateCommand,
  type CrmTaskStatus,
  type CrmTaskUpdateCommand,
  type CrmTaskValidationResult,
} from './crm-writeback-validation';

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
