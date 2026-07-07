import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the gateway REGISTRY store — exercises the REAL create → read → delete
// write-paths of src/lib/gateways.ts against a REAL Postgres (the module self-creates its `gateways`
// table via ensureGatewaysSchema's CREATE TABLE IF NOT EXISTS). Skips (green) when no DB is up.
// All rows are written under dedicated org ids so real data is never touched.

const ORG = 'test-int-gateways';
const OTHER = 'test-int-gateways-other';

const dbUp = await dbReachable();

test('gateways store CRUD + org scoping against a real Postgres', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { ensureGatewaysSchema, createGateway, listGatewayRows, getGatewayRow, updateGateway, deleteGateway } =
    await import('@/lib/gateways');

  await ensureGatewaysSchema();

  t.after(async () => {
    for (const org of [ORG, OTHER]) {
      for (const g of await listGatewayRows(org)) await deleteGateway(g.id, org);
    }
  });

  // ── CREATE — egressClass is derived from kind, never trusted from input ──────────────────────────
  const cluster = await createGateway(
    { name: 'On-Prem Cluster', kind: 'on-prem', baseUrl: '', defaultModel: '', egressClass: 'cloud', enabled: true },
    ORG,
  );
  assert.match(cluster.id, /^gw_/);
  assert.equal(cluster.egressClass, 'on-prem', 'on-prem kind ⇒ on-prem egress regardless of input');

  const openai = await createGateway(
    { name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', egressClass: 'cloud', enabled: true },
    ORG,
  );
  assert.equal(openai.egressClass, 'cloud');

  // ── READ (list is org-scoped, stable order by name) ──────────────────────────────────────────────
  const listed = await listGatewayRows(ORG);
  assert.equal(listed.length, 2);
  assert.deepEqual(listed.map((g) => g.name), ['On-Prem Cluster', 'OpenAI'], 'ordered by name asc');

  // ── idempotent seed via stable id — a second create with the same id is a no-op ──────────────────
  const seeded = await createGateway(
    { id: 'gw_seed_test_int', name: 'Seeded', kind: 'compat', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: '', egressClass: 'cloud', enabled: true },
    ORG,
  );
  const seededAgain = await createGateway(
    { id: 'gw_seed_test_int', name: 'Seeded (changed)', kind: 'compat', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: '', egressClass: 'cloud', enabled: true },
    ORG,
  );
  assert.equal(seededAgain.id, seeded.id, 'same stable id returned');
  assert.equal(seededAgain.name, 'Seeded', 'onConflictDoNothing kept the original row');
  assert.equal((await listGatewayRows(ORG)).length, 3, 'no duplicate created');

  // ── ORG SCOPING — another org never sees these rows; get is org-scoped ───────────────────────────
  assert.equal((await listGatewayRows(OTHER)).length, 0, 'other org is empty');
  assert.equal(await getGatewayRow(openai.id, OTHER), null, 'cross-org get misses');
  assert.ok(await getGatewayRow(openai.id, ORG), 'same-org get hits');

  // ── UPDATE — persists name/kind/baseUrl/defaultModel/enabled + RE-DERIVES egress from the new kind ─
  const updated = await updateGateway(
    cluster.id,
    { name: 'Cluster → OpenRouter', kind: 'compat', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'gpt-4o-mini', enabled: false },
    ORG,
  );
  assert.ok(updated, 'update returned the fresh row');
  assert.equal(updated.name, 'Cluster → OpenRouter');
  assert.equal(updated.kind, 'compat');
  assert.equal(updated.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(updated.defaultModel, 'gpt-4o-mini');
  assert.equal(updated.enabled, false, 'enabled flag persisted');
  assert.equal(updated.egressClass, 'cloud', 'on-prem→compat re-derives egress to cloud');

  // Re-read confirms the write is durable, not just the returned row.
  const reread = await getGatewayRow(cluster.id, ORG);
  assert.ok(reread);
  assert.equal(reread.kind, 'compat');
  assert.equal(reread.egressClass, 'cloud');
  assert.equal(reread.enabled, false);

  // Flipping back to on-prem re-derives egress to on-prem (egress is never client-trusted).
  const backToOnPrem = await updateGateway(
    cluster.id,
    { name: 'Cluster', kind: 'on-prem', baseUrl: '', defaultModel: '', enabled: true },
    ORG,
  );
  assert.ok(backToOnPrem);
  assert.equal(backToOnPrem.egressClass, 'on-prem', 'compat→on-prem re-derives egress to on-prem');

  // ── UPDATE org isolation — another org can never update this row (returns null, row untouched) ────
  assert.equal(
    await updateGateway(cluster.id, { name: 'HIJACK', kind: 'openai', baseUrl: '', defaultModel: '', enabled: true }, OTHER),
    null,
    'cross-org update misses',
  );
  const afterCrossOrg = await getGatewayRow(cluster.id, ORG);
  assert.ok(afterCrossOrg);
  assert.equal(afterCrossOrg.name, 'Cluster', 'cross-org update left the row untouched');
  assert.equal(afterCrossOrg.egressClass, 'on-prem', 'cross-org update did not drift egress');

  // Update of a non-existent id returns null (graceful 404 at the route).
  assert.equal(
    await updateGateway('gw_does_not_exist', { name: 'X', kind: 'openai', baseUrl: '', defaultModel: '', enabled: true }, ORG),
    null,
    'unknown id ⇒ null',
  );

  // ── DELETE — org-scoped; cross-org delete misses ─────────────────────────────────────────────────
  assert.equal(await deleteGateway(openai.id, OTHER), false, 'cross-org delete misses');
  assert.equal(await deleteGateway(openai.id, ORG), true);
  assert.equal((await listGatewayRows(ORG)).length, 2, 'gone after delete');
  assert.equal(await deleteGateway(openai.id, ORG), false, 'second delete misses');
});
