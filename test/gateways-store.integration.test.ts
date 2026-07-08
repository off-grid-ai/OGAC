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

  // ── UPDATE (full) — persists name/kind/baseUrl/defaultModel/enabled + RE-DERIVES egress from kind ──
  const updated = await updateGateway(
    cluster.id,
    { name: 'Cluster → OpenRouter', kind: 'compat', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'gpt-4o-mini', enabled: false },
    ORG,
  );
  assert.ok(updated.ok, 'update returned the fresh row');
  assert.equal(updated.row.name, 'Cluster → OpenRouter');
  assert.equal(updated.row.kind, 'compat');
  assert.equal(updated.row.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(updated.row.defaultModel, 'gpt-4o-mini');
  assert.equal(updated.row.enabled, false, 'enabled flag persisted');
  assert.equal(updated.row.egressClass, 'cloud', 'on-prem→compat re-derives egress to cloud');

  // Re-read confirms the write is durable, not just the returned row.
  const reread = await getGatewayRow(cluster.id, ORG);
  assert.ok(reread);
  assert.equal(reread.kind, 'compat');
  assert.equal(reread.egressClass, 'cloud');
  assert.equal(reread.enabled, false);

  // ── UPDATE (PARTIAL, gap PA-10) — a defaultModel-only patch updates JUST that field ──────────────
  const partial = await updateGateway(cluster.id, { defaultModel: 'gpt-5-mini' }, ORG);
  assert.ok(partial.ok, 'partial patch succeeded');
  assert.equal(partial.row.defaultModel, 'gpt-5-mini', 'defaultModel updated');
  assert.equal(partial.row.name, 'Cluster → OpenRouter', 'name preserved (untouched by the patch)');
  assert.equal(partial.row.kind, 'compat', 'kind preserved');
  assert.equal(partial.row.baseUrl, 'https://openrouter.ai/api/v1', 'baseUrl preserved');
  assert.equal(partial.row.enabled, false, 'enabled preserved');

  // A merge that breaks the compat invariant (clearing baseUrl on a compat gateway) is a clean
  // rejection — NOT a silent no-op and NOT a persisted-but-unusable row.
  const rejected = await updateGateway(cluster.id, { baseUrl: '' }, ORG);
  assert.equal(rejected.ok, false, 'compat with empty baseUrl rejected');
  if (!rejected.ok) assert.equal(rejected.reason, 'invalid');
  const stillGood = await getGatewayRow(cluster.id, ORG);
  assert.equal(stillGood?.baseUrl, 'https://openrouter.ai/api/v1', 'rejected patch left baseUrl untouched');

  // Flipping back to on-prem re-derives egress to on-prem (egress is never client-trusted).
  const backToOnPrem = await updateGateway(
    cluster.id,
    { name: 'Cluster', kind: 'on-prem', baseUrl: '', defaultModel: '', enabled: true },
    ORG,
  );
  assert.ok(backToOnPrem.ok);
  assert.equal(backToOnPrem.row.egressClass, 'on-prem', 'compat→on-prem re-derives egress to on-prem');

  // ── UPDATE org isolation — another org can never update this row (not-found, row untouched) ───────
  const hijack = await updateGateway(cluster.id, { name: 'HIJACK' }, OTHER);
  assert.equal(hijack.ok, false, 'cross-org update misses');
  if (!hijack.ok) assert.equal(hijack.reason, 'not-found');
  const afterCrossOrg = await getGatewayRow(cluster.id, ORG);
  assert.ok(afterCrossOrg);
  assert.equal(afterCrossOrg.name, 'Cluster', 'cross-org update left the row untouched');
  assert.equal(afterCrossOrg.egressClass, 'on-prem', 'cross-org update did not drift egress');

  // Update of a non-existent id is not-found (graceful 404 at the route).
  const missing = await updateGateway('gw_does_not_exist', { name: 'X' }, ORG);
  assert.equal(missing.ok, false, 'unknown id ⇒ not ok');
  if (!missing.ok) assert.equal(missing.reason, 'not-found');

  // ── DELETE — org-scoped; cross-org delete misses ─────────────────────────────────────────────────
  assert.equal(await deleteGateway(openai.id, OTHER), false, 'cross-org delete misses');
  assert.equal(await deleteGateway(openai.id, ORG), true);
  assert.equal((await listGatewayRows(ORG)).length, 2, 'gone after delete');
  assert.equal(await deleteGateway(openai.id, ORG), false, 'second delete misses');
});

// PA-15 — per-tenant gateway HOST persistence + resolve-by-host + cross-org scoping, against a real
// Postgres (self-migrated `hostname` column). A deterministic random suffix is injected so the
// minted host is asserted exactly.
test('gateway hostname: provision persists + resolve-by-host is org-scoped', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { ensureGatewaysSchema, createGateway, getGatewayRow, provisionGatewayHost, getGatewayByHostname, listGatewayRows, deleteGateway } =
    await import('@/lib/gateways');
  const { tenantGatewayHost } = await import('@/lib/tenant-domain');

  await ensureGatewaysSchema();
  t.after(async () => {
    for (const org of [ORG, OTHER]) {
      for (const g of await listGatewayRows(org)) await deleteGateway(g.id, org);
    }
  });

  const gw = await createGateway(
    { name: 'Bharat On-Prem', kind: 'on-prem', baseUrl: '', defaultModel: '', egressClass: 'cloud', enabled: true },
    ORG,
  );
  assert.equal(gw.hostname ?? null, null, 'a fresh gateway has no provisioned host');

  // ── PROVISION — mints "<slug5><rand5>-gateway.<apex>" from the tenant slug + injected suffix ──────
  const expected = tenantGatewayHost('bharatunion', 'k7x2p'); // bharak7x2p-gateway.getoffgridai.co
  const provisioned = await provisionGatewayHost(gw.id, 'bharatunion', ORG, 'k7x2p');
  assert.ok(provisioned, 'provision returned the fresh row');
  assert.equal(provisioned.hostname, expected, 'minted host persisted on the row');

  // Re-read confirms durability (not just the returned row).
  const reread = await getGatewayRow(gw.id, ORG);
  assert.ok(reread);
  assert.equal(reread.hostname, expected, 'hostname reads back from the DB');

  // ── RESOLVE-BY-HOST — the attribution seam ───────────────────────────────────────────────────────
  const byHost = await getGatewayByHostname(expected, ORG);
  assert.ok(byHost, 'resolves the gateway from its provisioned host');
  assert.equal(byHost.id, gw.id);

  // ── CROSS-ORG SCOPING — another org never resolves or provisions this gateway ─────────────────────
  assert.equal(await getGatewayByHostname(expected, OTHER), null, 'cross-org resolve-by-host misses');
  assert.equal(
    await provisionGatewayHost(gw.id, 'bharatunion', OTHER, 'zzzzz'),
    null,
    'cross-org provision misses (returns null, row untouched)',
  );
  const afterCrossOrg = await getGatewayRow(gw.id, ORG);
  assert.ok(afterCrossOrg);
  assert.equal(afterCrossOrg.hostname, expected, 'cross-org provision left the host untouched');

  // Provisioning an unknown id returns null (graceful 404 at the route).
  assert.equal(await provisionGatewayHost('gw_nope', 'bharatunion', ORG, 'k7x2p'), null, 'unknown id ⇒ null');
});
