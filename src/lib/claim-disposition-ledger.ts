import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

export interface ClaimDispositionLedgerInput {
  orgId: string;
  connectorId: string;
  idempotencyKey: string;
  commandHash: string;
  claimId: string;
  disposition: string;
  authorityBasis: string;
  authorityReference: string;
  actorId: string;
}

export interface ClaimDispositionStoredResult {
  beforeStatus: string;
  afterStatus: string;
  sourceRecord: Record<string, unknown>;
}

export type ClaimDispositionReservation =
  | { state: 'execute'; token: string }
  | { state: 'replay'; result: ClaimDispositionStoredResult }
  | { state: 'conflict' }
  | { state: 'in-progress' };

type LedgerRow = {
  command_hash: string;
  state: 'pending' | 'done' | 'failed';
  execution_token: string;
  actor_id: string;
  lease_until: Date | string;
  result_json: ClaimDispositionStoredResult | null;
};

let ensurePromise: Promise<void> | null = null;
export async function ensureClaimDispositionLedger(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS claim_disposition_commands (
        org_id text NOT NULL,
        connector_id text NOT NULL,
        idempotency_key text NOT NULL,
        command_hash text NOT NULL,
        claim_id text NOT NULL,
        disposition text NOT NULL,
        authority_basis text NOT NULL,
        authority_reference text NOT NULL,
        actor_id text NOT NULL,
        state text NOT NULL DEFAULT 'pending',
        execution_token text NOT NULL,
        lease_until timestamptz NOT NULL,
        result_json jsonb,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (org_id, connector_id, idempotency_key));
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS claim_disposition_claim_idx
      ON claim_disposition_commands (org_id, connector_id, claim_id);
    `);
  })().catch((error) => {
    ensurePromise = null;
    throw error;
  });
  return ensurePromise;
}

function rows<T>(result: unknown): T[] {
  const value = result as { rows?: T[] };
  return value.rows ?? (result as T[]);
}

export async function reserveClaimDisposition(
  input: ClaimDispositionLedgerInput,
): Promise<ClaimDispositionReservation> {
  await ensureClaimDispositionLedger();
  const token = randomUUID();
  const inserted = await db.execute<LedgerRow>(sql`
    INSERT INTO claim_disposition_commands (
      org_id, connector_id, idempotency_key, command_hash, claim_id, disposition,
      authority_basis, authority_reference, actor_id, state, execution_token, lease_until)
    VALUES (
      ${input.orgId}, ${input.connectorId}, ${input.idempotencyKey}, ${input.commandHash},
      ${input.claimId}, ${input.disposition}, ${input.authorityBasis}, ${input.authorityReference},
      ${input.actorId}, 'pending', ${token}, now() + interval '30 seconds')
    ON CONFLICT (org_id, connector_id, idempotency_key) DO NOTHING
    RETURNING command_hash, state, execution_token, actor_id, lease_until, result_json;
  `);
  if (rows<LedgerRow>(inserted).length > 0) return { state: 'execute', token };

  const selected = await db.execute<LedgerRow>(sql`
    SELECT command_hash, state, execution_token, actor_id, lease_until, result_json
    FROM claim_disposition_commands
    WHERE org_id = ${input.orgId} AND connector_id = ${input.connectorId}
      AND idempotency_key = ${input.idempotencyKey}
    LIMIT 1;
  `);
  const current = rows<LedgerRow>(selected)[0];
  if (
    !current ||
    current.command_hash !== input.commandHash ||
    current.actor_id !== input.actorId
  ) return { state: 'conflict' };
  if (current.state === 'done' && current.result_json) {
    return { state: 'replay', result: current.result_json };
  }
  if (current.state === 'pending' && new Date(current.lease_until).getTime() > Date.now()) {
    return { state: 'in-progress' };
  }

  const resumed = await db.execute<LedgerRow>(sql`
    UPDATE claim_disposition_commands
    SET state = 'pending', execution_token = ${token}, lease_until = now() + interval '30 seconds',
        last_error = NULL, updated_at = now()
    WHERE org_id = ${input.orgId} AND connector_id = ${input.connectorId}
      AND idempotency_key = ${input.idempotencyKey}
      AND command_hash = ${input.commandHash}
      AND (state = 'failed' OR lease_until <= now())
    RETURNING command_hash, state, execution_token, actor_id, lease_until, result_json;
  `);
  return rows<LedgerRow>(resumed).length > 0 ? { state: 'execute', token } : { state: 'in-progress' };
}

export async function completeClaimDisposition(
  input: ClaimDispositionLedgerInput,
  token: string,
  result: ClaimDispositionStoredResult,
): Promise<boolean> {
  const updated = await db.execute(sql`
    UPDATE claim_disposition_commands
    SET state = 'done', result_json = ${JSON.stringify(result)}::jsonb, updated_at = now()
    WHERE org_id = ${input.orgId} AND connector_id = ${input.connectorId}
      AND idempotency_key = ${input.idempotencyKey} AND execution_token = ${token}
      AND state = 'pending'
    RETURNING idempotency_key;
  `);
  return rows<{ idempotency_key: string }>(updated).length === 1;
}

export async function failClaimDisposition(
  input: ClaimDispositionLedgerInput,
  token: string,
  message: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE claim_disposition_commands
    SET state = 'failed', last_error = ${message.slice(0, 500)}, lease_until = now(), updated_at = now()
    WHERE org_id = ${input.orgId} AND connector_id = ${input.connectorId}
      AND idempotency_key = ${input.idempotencyKey} AND execution_token = ${token};
  `);
}

export async function deleteClaimDispositionCommandsForOrg(orgId: string): Promise<void> {
  await ensureClaimDispositionLedger();
  await db.execute(sql`DELETE FROM claim_disposition_commands WHERE org_id = ${orgId};`);
}
