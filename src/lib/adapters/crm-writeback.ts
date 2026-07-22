import { getSigning } from '@/lib/adapters/registry';
import {
  buildCrmOpportunityPatch,
  crmCommandHash,
  crmRecordHash,
  crmWritebackIdempotencyState,
  validateCrmOpportunityWriteback,
  type CrmOpportunityWritebackInput,
  type ValidatedCrmOpportunityWriteback,
} from '@/lib/crm-writeback';
import {
  execRestConnectorRequest,
  type ConnectorTarget,
} from '@/lib/connector-exec';

export type CrmWritebackErrorCode =
  | 'invalid-command'
  | 'unsupported-connector'
  | 'record-not-found'
  | 'idempotency-conflict'
  | 'upstream-error';

export interface CrmWritebackReceipt {
  connectorId: string;
  opportunityId: string;
  orgId: string;
  useCase: string;
  idempotencyKey: string;
  commandHash: string;
  replayed: boolean;
  changedFields: string[];
  recordHash: string;
  signedAt: string;
  algorithm: string;
  publicKey: string | null;
  signature: string;
}

export type CrmWritebackResult =
  | { ok: true; record: Record<string, unknown>; receipt: CrmWritebackReceipt }
  | { ok: false; code: CrmWritebackErrorCode; message: string };

function signReceipt(
  connector: ConnectorTarget,
  input: ValidatedCrmOpportunityWriteback,
  orgId: string,
  record: Record<string, unknown>,
  replayed: boolean,
  signedAt: string,
): CrmWritebackReceipt {
  const signing = getSigning();
  const core = {
    connectorId: connector.id ?? 'unknown',
    opportunityId: input.opportunityId,
    orgId,
    useCase: input.useCase,
    idempotencyKey: input.idempotencyKey,
    commandHash: crmCommandHash(input),
    replayed,
    changedFields: [...(input.stage ? ['stage'] : []), 'next_action', 'offgrid_writeback'],
    recordHash: crmRecordHash(record),
    signedAt,
  };
  return {
    ...core,
    algorithm: signing.algorithm,
    publicKey: signing.publicKey(),
    signature: signing.sign(core),
  };
}

// Governed update of one existing CRM opportunity. This function never accepts a path, HTTP verb,
// or free-form patch from the caller. It reads before writing for not-found and idempotency checks,
// then PATCHes only the allowlisted fields built by the pure contract.
export async function writeCrmOpportunityFollowUp(
  connector: ConnectorTarget,
  command: CrmOpportunityWritebackInput | unknown,
  orgId: string,
  now: () => Date = () => new Date(),
): Promise<CrmWritebackResult> {
  const validated = validateCrmOpportunityWriteback(command);
  if (!validated.ok || !validated.value) {
    return { ok: false, code: 'invalid-command', message: validated.errors.join(' ') };
  }
  if (!connector.id) {
    return { ok: false, code: 'unsupported-connector', message: 'connector id is required' };
  }

  const input = validated.value;
  const scopedConnector = { ...connector, orgId };
  const current = await execRestConnectorRequest(scopedConnector, {
    method: 'GET',
    path: ['opportunities', input.opportunityId],
  });
  if (!current) {
    return { ok: false, code: 'unsupported-connector', message: 'connector is not a reachable REST source' };
  }
  if (current.status === 404) {
    return { ok: false, code: 'record-not-found', message: 'CRM opportunity was not found' };
  }
  if (!current.ok || !current.body || typeof current.body !== 'object' || Array.isArray(current.body)) {
    return { ok: false, code: 'upstream-error', message: `CRM read failed with status ${current.status}` };
  }

  const existing = current.body as Record<string, unknown>;
  const signedAt = now().toISOString();
  const idempotencyState = crmWritebackIdempotencyState(
    existing,
    orgId,
    input.idempotencyKey,
    crmCommandHash(input),
  );
  if (idempotencyState === 'conflict') {
    return {
      ok: false,
      code: 'idempotency-conflict',
      message: 'idempotency key was already used for a different CRM command',
    };
  }
  if (idempotencyState === 'replay') {
    return {
      ok: true,
      record: existing,
      receipt: signReceipt(connector, input, orgId, existing, true, signedAt),
    };
  }

  const patch = buildCrmOpportunityPatch(input, { orgId, writtenAt: signedAt });
  const updated = await execRestConnectorRequest(scopedConnector, {
    method: 'PATCH',
    path: ['opportunities', input.opportunityId],
    body: patch,
  });
  if (!updated?.ok || !updated.body || typeof updated.body !== 'object' || Array.isArray(updated.body)) {
    return {
      ok: false,
      code: updated ? 'upstream-error' : 'unsupported-connector',
      message: updated ? `CRM write failed with status ${updated.status}` : 'connector is not a reachable REST source',
    };
  }

  const record = updated.body as Record<string, unknown>;
  return {
    ok: true,
    record,
    receipt: signReceipt(connector, input, orgId, record, false, signedAt),
  };
}
