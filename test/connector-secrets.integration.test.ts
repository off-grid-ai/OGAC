import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the connector credential seam against a REAL Postgres, through the @/*
// resolver hook. Proves the ADDITIVE secret_ref column self-migrates, that a connector row can carry
// a secretRef, and that getConnectorSecretRef reads it back — the DB half of the vault wiring.
// The actual OpenBao read/write is covered where a vault is configured (OFFGRID_OPENBAO_URL); here
// we prove the column + resolution plumbing without depending on a live vault.
//
// Skips green if Postgres is down. All rows are written under a dedicated org id.

const ORG = 'test-int-connector-secrets';
const dbUp = await dbReachable();

test('connector secret_ref column self-migrates + round-trips', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { createConnector, deleteConnector, listConnectors } = await import('@/lib/store');
  const { ensureConnectorSecretRefColumn, getConnectorSecretRef, connectorSecretKey } =
    await import('@/lib/connector-secrets');
  const { db } = await import('@/db');
  const { connectors } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  t.after(async () => {
    for (const c of await listConnectors(ORG)) await deleteConnector(c.id);
  });

  // The additive column must exist (idempotent ALTER … ADD COLUMN IF NOT EXISTS).
  await ensureConnectorSecretRefColumn();

  const created = await createConnector({
    name: 'Vaulted Postgres',
    type: 'postgres',
    endpoint: 'postgres://reader@db.internal:5432/corebank', // credential-FREE
    auth: 'api-key',
    custom: true,
    orgId: ORG,
  });
  // Freshly created connector has no secretRef yet.
  assert.equal(await getConnectorSecretRef(created.id), null);

  // Stamp a secretRef directly (mirrors what persistConnectorSecret does after the vault write).
  const ref = connectorSecretKey(created.id);
  await db.update(connectors).set({ secretRef: ref }).where(eq(connectors.id, created.id));

  // Read it back through the module's resolver.
  assert.equal(await getConnectorSecretRef(created.id), ref);

  // The stored endpoint is still credential-free — the password never touched the row.
  const listed = (await listConnectors(ORG)).find((c) => c.id === created.id);
  assert.ok(listed);
  assert.ok(!listed!.endpoint.includes(':@') && !/:[^@/]+@/.test(listed!.endpoint.replace('reader@', '')),
    'endpoint carries no password');
});
