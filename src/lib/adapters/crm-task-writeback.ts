import { getSigning } from '@/lib/adapters/registry';
import { execRestConnectorRequest, type ConnectorTarget } from '@/lib/connector-exec';
import {
  buildCrmTaskSourceRequest,
  crmTaskCommandHash,
  crmTaskHash,
  validateCrmTaskCommand,
  type CrmTaskCommand,
} from '@/lib/crm-task-writeback';
import type { CrmWritebackErrorCode } from './crm-writeback';

export const CRM_TASK_API_VERSION = '2026-07-20';

export interface CrmTaskWritebackReceipt {
  operation: CrmTaskCommand['operation'];
  connectorId: string;
  taskId: string;
  orgId: string;
  idempotencyKey: string;
  commandHash: string;
  taskHash: string;
  replayed: boolean;
  apiVersion: string;
  signedAt: string;
  algorithm: string;
  publicKey: string | null;
  signature: string;
}

export type CrmTaskWritebackResult =
  | { ok: true; task: Record<string, unknown>; receipt: CrmTaskWritebackReceipt }
  | { ok: false; code: CrmWritebackErrorCode; message: string };

function validatedResponse(
  body: unknown,
  expectedOrgId: string,
): { task: Record<string, unknown>; apiVersion: string; replayed: boolean } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  if (raw.apiVersion !== CRM_TASK_API_VERSION || !raw.task || typeof raw.task !== 'object' || Array.isArray(raw.task)) return null;
  const task = raw.task as Record<string, unknown>;
  if (!/^task_[a-f0-9]{16}$/.test(String(task.id ?? '')) || task.orgId !== expectedOrgId) return null;
  return { task, apiVersion: raw.apiVersion, replayed: raw.replayed === true };
}

export async function writeCrmTask(
  connector: ConnectorTarget,
  rawCommand: unknown,
  orgId: string,
  now: () => Date = () => new Date(),
): Promise<CrmTaskWritebackResult> {
  const validated = validateCrmTaskCommand(rawCommand);
  if (!validated.ok) return { ok: false, code: 'invalid-command', message: validated.errors.join(' ') };
  if (!connector.id) return { ok: false, code: 'unsupported-connector', message: 'connector id is required' };
  const request = buildCrmTaskSourceRequest(validated.value);
  const response = await execRestConnectorRequest({ ...connector, orgId }, {
    ...request,
    headers: { 'x-offgrid-org-id': orgId },
  });
  if (!response) return { ok: false, code: 'unsupported-connector', message: 'connector is not a reachable REST source' };
  if (response.status === 404) return { ok: false, code: 'record-not-found', message: 'CRM task was not found' };
  if (response.status === 409) return { ok: false, code: 'idempotency-conflict', message: 'idempotency key was already used for a different CRM task command' };
  if (!response.ok) return { ok: false, code: 'upstream-error', message: `CRM task write failed with status ${response.status}` };
  const parsed = validatedResponse(response.body, orgId);
  if (!parsed || response.headers['x-offgrid-crm-api-version'] !== CRM_TASK_API_VERSION) {
    return { ok: false, code: 'upstream-error', message: 'CRM task API returned an unsupported contract' };
  }
  const signedAt = now().toISOString();
  const signing = getSigning();
  const core = {
    operation: validated.value.operation,
    connectorId: connector.id,
    taskId: String(parsed.task.id ?? ''),
    orgId,
    idempotencyKey: validated.value.idempotencyKey,
    commandHash: crmTaskCommandHash(validated.value),
    taskHash: crmTaskHash(parsed.task),
    replayed: parsed.replayed || response.headers['x-idempotent-replay'] === 'true',
    apiVersion: parsed.apiVersion,
    signedAt,
  };
  return {
    ok: true,
    task: parsed.task,
    receipt: { ...core, algorithm: signing.algorithm, publicKey: signing.publicKey(), signature: signing.sign(core) },
  };
}
