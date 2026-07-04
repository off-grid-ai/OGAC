import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for connector CRUD in src/lib/store.ts — exercises the REAL
// create → read → update → sync → delete write-paths against a REAL Postgres, through the @/*
// resolver hook. Proves the integrations module's management surface works end-to-end.
//
// Runs against the app's DATABASE_URL (default offgrid_console). Skips green if the DB is down.
// All rows are written under a dedicated org id so real data is never touched.

const ORG = 'test-int-connectors';

const dbUp = await dbReachable();

test('connector CRUD against a real Postgres', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { createConnector, listConnectors, updateConnector, deleteConnector, syncConnector } =
    await import('@/lib/store');

  t.after(async () => {
    for (const c of await listConnectors(ORG)) await deleteConnector(c.id);
  });

  // ── CREATE ───────────────────────────────────────────────────────────────────────────────────
  const created = await createConnector({
    name: 'Test HTTP source',
    type: 'http',
    endpoint: 'https://example.invalid/api',
    auth: 'api-key',
    description: 'integration-test connector',
    custom: true,
    orgId: ORG,
  });
  assert.match(created.id, /^con_/, 'id is prefixed');
  assert.equal(created.name, 'Test HTTP source');
  assert.equal(created.auth, 'api-key');
  assert.equal(created.custom, true);
  assert.equal(created.lastSync, null, 'never synced yet');

  // ── READ (org-scoped) ──────────────────────────────────────────────────────────────────────────
  const listed = await listConnectors(ORG);
  assert.equal(listed.length, 1, 'org sees exactly its one connector');
  assert.equal(listed[0].id, created.id);

  // ── UPDATE ────────────────────────────────────────────────────────────────────────────────────
  const updated = await updateConnector(created.id, {
    name: 'Renamed source',
    auth: 'oauth',
    description: 'edited',
  });
  assert.ok(updated, 'update returns the row');
  assert.equal(updated!.name, 'Renamed source');
  assert.equal(updated!.auth, 'oauth');
  // Unspecified fields are preserved.
  assert.equal(updated!.type, 'http', 'type untouched by partial patch');
  assert.equal(updated!.endpoint, 'https://example.invalid/api', 'endpoint untouched');

  // Empty patch is a no-op that still returns the current row (not a wipe).
  const noop = await updateConnector(created.id, {});
  assert.equal(noop!.name, 'Renamed source', 'empty patch preserves the row');

  // Updating an unknown id misses cleanly.
  assert.equal(await updateConnector('con_nope99', { name: 'x' }), null, 'unknown id → null');

  // ── SYNC (records an ingest job; endpoint is unreachable → status error, records 0) ────────────
  const job = await syncConnector(created.id);
  assert.ok(job, 'sync returns a job for a known connector');
  assert.equal(job!.connectorId, created.id);
  const afterSync = (await listConnectors(ORG)).find((c) => c.id === created.id);
  assert.ok(afterSync!.lastSync, 'lastSync is stamped after a sync');

  // Syncing an unknown connector is a clean null.
  assert.equal(await syncConnector('con_nope99'), null, 'sync unknown → null');

  // ── DELETE (also removes ingest history) ───────────────────────────────────────────────────────
  await deleteConnector(created.id);
  assert.equal((await listConnectors(ORG)).length, 0, 'list empty after delete');
});
