import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from 'pg';
import { getSigning } from '@/lib/adapters/registry';
import {
  claimDispositionCommandHash,
  claimTransitionVerdict,
  validateClaimDisposition,
} from '@/lib/claim-disposition';
import { deleteClaimDispositionCommandsForOrg } from '@/lib/claim-disposition-ledger';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

const COMMAND = {
  claimId: 'CLM0001001',
  idempotencyKey: 'claim:CLM0001001:decision:v1',
  disposition: 'approve',
  authority: {
    basis: 'documents-complete',
    reference: 'REVIEW-2026-1001',
    reason: 'All required documents and policy checks passed.',
  },
} as const;

test('claim disposition validates the bounded command and derives the source status', () => {
  const valid = validateClaimDisposition(COMMAND);
  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.equal(valid.value.sourceStatus, 'approved');
  assert.equal(valid.value.commandHash, claimDispositionCommandHash(valid.value));

  const invalid = validateClaimDisposition({
    ...COMMAND,
    claimId: '../claim',
    disposition: 'delete',
    authority: { basis: 'ceo-said-so', reference: 'x', reason: 'short' },
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.ok(invalid.errors.some((error) => error.includes('claimId')));
    assert.ok(invalid.errors.some((error) => error.includes('disposition')));
    assert.ok(invalid.errors.some((error) => error.includes('authority.basis')));
  }
});

test('claim disposition never reopens terminal source states', () => {
  assert.equal(claimTransitionVerdict('under_review', 'approved'), 'apply');
  assert.equal(claimTransitionVerdict('approved', 'approved'), 'already-applied');
  assert.equal(claimTransitionVerdict('settled', 'under_review'), 'terminal');
  assert.equal(claimTransitionVerdict('repudiated', 'approved'), 'terminal');
});

const dbUp = await dbReachable();

test('claim disposition writes the real PostgreSQL source once and replays from the Console ledger', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://offgrid@localhost:5432/offgrid_console';
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  const schema = `test_claim_disposition_${Date.now()}`;
  const orgId = `test-claim-disposition-${Date.now()}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`
    CREATE TABLE "${schema}".claims (
      claim_id text PRIMARY KEY,
      status text NOT NULL,
      claim_amount_inr numeric(18,2),
      contestability_flag text);
  `);
  await admin.query(
    `INSERT INTO "${schema}".claims (claim_id, status, claim_amount_inr, contestability_flag)
     VALUES ($1, 'under_review', 250000, 'outside')`,
    [COMMAND.claimId],
  );
  t.after(async () => {
    await deleteClaimDispositionCommandsForOrg(orgId).catch(() => undefined);
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await admin.end();
  });

  const sourceUrl = new URL(databaseUrl);
  sourceUrl.searchParams.set('options', `-csearch_path=${schema}`);
  const connector = { id: 'surcon_coreins_test', type: 'postgres', endpoint: sourceUrl.toString() };
  const { writeClaimDisposition } = await import('@/lib/adapters/claim-disposition-writeback');
  const clock = () => new Date('2026-07-20T13:00:00.000Z');

  const first = await writeClaimDisposition(connector, COMMAND, orgId, 'claims-admin@example.test', clock);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.receipt.replayed, false);
  assert.equal(first.receipt.beforeStatus, 'under_review');
  assert.equal(first.receipt.afterStatus, 'approved');
  const { signature, algorithm: _algorithm, publicKey: _publicKey, ...signed } = first.receipt;
  assert.equal(getSigning().verify(signed, signature), true);
  const source = await admin.query(`SELECT status FROM "${schema}".claims WHERE claim_id = $1`, [COMMAND.claimId]);
  assert.equal(source.rows[0].status, 'approved');

  const replay = await writeClaimDisposition(connector, COMMAND, orgId, 'claims-admin@example.test', clock);
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.receipt.replayed, true);
  assert.equal(replay.receipt.beforeStatus, 'under_review', 'replay returns the original source transition');

  const otherActor = await writeClaimDisposition(
    connector,
    COMMAND,
    orgId,
    'different-admin@example.test',
    clock,
  );
  assert.equal(otherActor.ok, false);
  if (!otherActor.ok) assert.equal(otherActor.code, 'idempotency-conflict');

  const conflict = await writeClaimDisposition(
    connector,
    { ...COMMAND, authority: { ...COMMAND.authority, reason: 'A materially different decision record.' } },
    orgId,
    'claims-admin@example.test',
    clock,
  );
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.code, 'idempotency-conflict');

  const terminal = await writeClaimDisposition(
    connector,
    { ...COMMAND, idempotencyKey: 'claim:CLM0001001:decision:v2', disposition: 'repudiate' },
    orgId,
    'claims-admin@example.test',
    clock,
  );
  assert.equal(terminal.ok, false);
  if (!terminal.ok) assert.equal(terminal.code, 'terminal-claim');
});
