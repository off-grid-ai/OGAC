import { createHash } from 'node:crypto';
import { getSigning } from '@/lib/adapters/registry';
import {
  completeClaimDisposition,
  failClaimDisposition,
  reserveClaimDisposition,
  type ClaimDispositionLedgerInput,
  type ClaimDispositionStoredResult,
} from '@/lib/claim-disposition-ledger';
import {
  claimTransitionVerdict,
  reasonHash,
  validateClaimDisposition,
  type ClaimDispositionInput,
  type ValidatedClaimDisposition,
} from '@/lib/claim-disposition';
import {
  detectDialect,
  resolveConnectorTarget,
  type ConnectorTarget,
} from '@/lib/connector-exec';

export type ClaimDispositionErrorCode =
  | 'invalid-command'
  | 'unsupported-connector'
  | 'idempotency-conflict'
  | 'in-progress'
  | 'claim-not-found'
  | 'terminal-claim'
  | 'source-error';

export interface ClaimDispositionReceipt {
  connectorId: string;
  orgId: string;
  claimId: string;
  idempotencyKey: string;
  commandHash: string;
  disposition: string;
  authorityBasis: string;
  authorityReference: string;
  authorityReasonHash: string;
  actorId: string;
  beforeStatus: string;
  afterStatus: string;
  sourceRecordHash: string;
  replayed: boolean;
  signedAt: string;
  algorithm: string;
  publicKey: string | null;
  signature: string;
}

export type ClaimDispositionResult =
  | { ok: true; receipt: ClaimDispositionReceipt }
  | { ok: false; code: ClaimDispositionErrorCode; message: string };

type SourceRecord = {
  claim_id: string;
  status: string;
  claim_amount_inr: string | number | null;
  contestability_flag: string | null;
};

type SourceMutationResult =
  | { ok: true; result: ClaimDispositionStoredResult }
  | { ok: false; code: 'claim-not-found' | 'terminal-claim' | 'source-error'; message: string };

function sourceRecordHash(record: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex');
}

function makeReceipt(
  connectorId: string,
  orgId: string,
  actorId: string,
  command: ValidatedClaimDisposition,
  result: ClaimDispositionStoredResult,
  replayed: boolean,
  signedAt: string,
): ClaimDispositionReceipt {
  const signing = getSigning();
  const core = {
    connectorId,
    orgId,
    claimId: command.claimId,
    idempotencyKey: command.idempotencyKey,
    commandHash: command.commandHash,
    disposition: command.disposition,
    authorityBasis: command.authority.basis,
    authorityReference: command.authority.reference,
    authorityReasonHash: reasonHash(command.authority.reason),
    actorId,
    beforeStatus: result.beforeStatus,
    afterStatus: result.afterStatus,
    sourceRecordHash: sourceRecordHash(result.sourceRecord),
    replayed,
    signedAt,
  };
  return {
    ...core,
    algorithm: signing.algorithm,
    publicKey: signing.publicKey(),
    signature: signing.sign(core),
  };
}

async function mutateClaimSource(
  connector: ConnectorTarget,
  command: ValidatedClaimDisposition,
): Promise<SourceMutationResult> {
  if (detectDialect(connector.type, connector.endpoint) !== 'postgres') {
    return {
      ok: false,
      code: 'source-error',
      message: 'claim disposition requires the Core Insurance PostgreSQL source',
    };
  }
  const resolved = await resolveConnectorTarget(connector);
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: resolved.endpoint, connectionTimeoutMillis: 4000, max: 1 });
  const client = await pool.connect().catch(() => null);
  if (!client) {
    await pool.end().catch(() => undefined);
    return { ok: false, code: 'source-error', message: 'Core Insurance source is unavailable' };
  }
  try {
    await client.query('BEGIN');
    const selected = await client.query<SourceRecord>(
      `SELECT claim_id, status, claim_amount_inr, contestability_flag
       FROM claims WHERE claim_id = $1 FOR UPDATE`,
      [command.claimId],
    );
    const current = selected.rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'claim-not-found', message: 'claim was not found in Core Insurance' };
    }
    const verdict = claimTransitionVerdict(current.status, command.sourceStatus);
    if (verdict === 'terminal') {
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: 'terminal-claim',
        message: `claim is terminal in status ${current.status}`,
      };
    }
    let after = current;
    if (verdict === 'apply') {
      const updated = await client.query<SourceRecord>(
        `UPDATE claims SET status = $2
         WHERE claim_id = $1 AND status = $3
         RETURNING claim_id, status, claim_amount_inr, contestability_flag`,
        [command.claimId, command.sourceStatus, current.status],
      );
      if (!updated.rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'source-error', message: 'claim changed concurrently; retry with a new review' };
      }
      after = updated.rows[0];
    }
    await client.query('COMMIT');
    return {
      ok: true,
      result: {
        beforeStatus: current.status,
        afterStatus: after.status,
        sourceRecord: {
          claimId: after.claim_id,
          status: after.status,
          claimAmountInr: after.claim_amount_inr,
          contestabilityFlag: after.contestability_flag,
        },
      },
    };
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    return {
      ok: false,
      code: 'source-error',
      message: 'Core Insurance mutation failed',
    };
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

export async function writeClaimDisposition(
  connector: ConnectorTarget,
  input: ClaimDispositionInput | unknown,
  orgId: string,
  actorId: string,
  now: () => Date = () => new Date(),
): Promise<ClaimDispositionResult> {
  const validated = validateClaimDisposition(input);
  if (!validated.ok) {
    return { ok: false, code: 'invalid-command', message: validated.errors.join(' ') };
  }
  if (!connector.id || detectDialect(connector.type, connector.endpoint) !== 'postgres') {
    return {
      ok: false,
      code: 'unsupported-connector',
      message: 'claim disposition requires an owned Core Insurance PostgreSQL connector',
    };
  }
  const command = validated.value;
  const ledgerInput: ClaimDispositionLedgerInput = {
    orgId,
    connectorId: connector.id,
    idempotencyKey: command.idempotencyKey,
    commandHash: command.commandHash,
    claimId: command.claimId,
    disposition: command.disposition,
    authorityBasis: command.authority.basis,
    authorityReference: command.authority.reference,
    actorId,
  };
  let reservation;
  try {
    reservation = await reserveClaimDisposition(ledgerInput);
  } catch {
    return { ok: false, code: 'source-error', message: 'claim disposition ledger is unavailable' };
  }
  if (reservation.state === 'conflict') {
    return { ok: false, code: 'idempotency-conflict', message: 'idempotency key belongs to a different disposition command' };
  }
  if (reservation.state === 'in-progress') {
    return { ok: false, code: 'in-progress', message: 'the same claim disposition is already in progress' };
  }
  if (reservation.state === 'replay') {
    return {
      ok: true,
      receipt: makeReceipt(
        connector.id, orgId, actorId, command, reservation.result, true, now().toISOString(),
      ),
    };
  }

  const mutation = await mutateClaimSource(connector, command);
  if (!mutation.ok) {
    await failClaimDisposition(ledgerInput, reservation.token, mutation.message).catch(() => undefined);
    return mutation;
  }
  const completed = await completeClaimDisposition(ledgerInput, reservation.token, mutation.result)
    .catch(() => false);
  if (!completed) {
    return {
      ok: false,
      code: 'source-error',
      message: 'claim was updated but the disposition receipt could not be committed; retry safely',
    };
  }
  return {
    ok: true,
    receipt: makeReceipt(
      connector.id, orgId, actorId, command, mutation.result, false, now().toISOString(),
    ),
  };
}
