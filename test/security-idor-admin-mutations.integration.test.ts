import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// SECURITY — cross-tenant IDOR integration tests (real Postgres). Proves that org A cannot tamper
// with org B's admin resources via a guessed/enumerated id: the store mutation is org-scoped so a
// cross-tenant call is a no-op and B's PERSISTED row is unchanged, while the same-org call still
// works. Each scenario asserts the terminal artifact (the row read back from the DB), reached from
// the real store function — not a call-shape. Skips (green) when no DB is up. Rows live under
// dedicated `test-idor-*` orgs so real data is untouched.

const A = `test-idor-a-${randomUUID().slice(0, 8)}`;
const B = `test-idor-b-${randomUUID().slice(0, 8)}`;

const dbUp = await dbReachable();
const skip = dbUp ? false : SKIP_MESSAGE;

test('connectors: org A cannot update or delete org B connector (P1 IDOR)', { skip }, async (t) => {
  const store = await import('@/lib/store');
  const { db } = await import('@/db');
  const { connectors } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const cA = await store.createConnector({ name: 'A-conn', type: 'http', orgId: A });
  const cB = await store.createConnector({ name: 'B-conn', type: 'http', orgId: B });

  t.after(async () => {
    for (const id of [cA.id, cB.id]) await db.delete(connectors).where(eq(connectors.id, id)).catch(() => {});
  });

  // UPDATE — A tries to rename B's connector (guessed id). Blocked → null, B's row untouched.
  const badUpdate = await store.updateConnector(cB.id, { name: 'HIJACKED' }, A);
  assert.equal(badUpdate, null, 'cross-org update returns null (404 at the route)');
  const bAfter = (await store.listConnectors(B)).find((c) => c.id === cB.id);
  assert.equal(bAfter?.name, 'B-conn', "B's connector name unchanged after cross-org update");

  // UPDATE — same-org edit hits and persists.
  const okUpdate = await store.updateConnector(cB.id, { name: 'B-renamed' }, B);
  assert.equal(okUpdate?.name, 'B-renamed', 'same-org update returns the row');
  assert.equal(
    (await store.listConnectors(B)).find((c) => c.id === cB.id)?.name,
    'B-renamed',
    'same-org update persisted',
  );

  // DELETE — A tries to delete B's connector. No-op; B's row still there.
  await store.deleteConnector(cB.id, A);
  assert.ok(
    (await store.listConnectors(B)).some((c) => c.id === cB.id),
    'cross-org delete did NOT remove B connector',
  );

  // DELETE — same-org delete removes it.
  await store.deleteConnector(cB.id, B);
  assert.ok(
    !(await store.listConnectors(B)).some((c) => c.id === cB.id),
    'same-org delete removed B connector',
  );

  // A's own connector is untouched throughout.
  assert.ok((await store.listConnectors(A)).some((c) => c.id === cA.id), "A's connector intact");
});

test("connectors: cross-org delete does NOT purge B's ingest history (cascade is org-scoped)", { skip }, async (t) => {
  const store = await import('@/lib/store');
  const { db } = await import('@/db');
  const { connectors, ingestJobs } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const cB = await store.createConnector({ name: 'B-conn-sync', type: 'http', orgId: B });
  await store.syncConnector(cB.id, B); // records an ingest job under org B

  t.after(async () => {
    await db.delete(ingestJobs).where(eq(ingestJobs.connectorId, cB.id)).catch(() => {});
    await db.delete(connectors).where(eq(connectors.id, cB.id)).catch(() => {});
  });

  assert.equal((await store.listIngestJobs(B)).length >= 1, true, 'B has an ingest job to protect');

  // A's cross-org delete must NOT cascade-purge B's ingest jobs.
  await store.deleteConnector(cB.id, A);
  assert.ok(
    (await store.listIngestJobs(B)).some((j) => j.connectorId === cB.id),
    "cross-org delete left B's ingest job intact",
  );

  // Same-org delete purges both.
  await store.deleteConnector(cB.id, B);
  assert.ok(
    !(await store.listIngestJobs(B)).some((j) => j.connectorId === cB.id),
    "same-org delete purged B's ingest job",
  );
});

test('api keys: org A cannot enable/disable, rate-limit, or delete org B key (P1 IDOR)', { skip }, async (t) => {
  const store = await import('@/lib/store');
  const rl = await import('@/lib/rate-limit-store');
  const { db } = await import('@/db');
  const { apiKeys } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  await store.ensureOrgSchema(); // self-heal api_keys.org_id on a pre-migration DB

  const { key: kB } = await store.createApiKey({
    name: 'B-key',
    subjectType: 'user',
    subject: 'b@test',
    budgetUsd: null,
    orgId: B,
  });

  const rowEnabled = async (id: string): Promise<boolean | undefined> =>
    (await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1))[0]?.enabled;

  t.after(async () => {
    await db.delete(apiKeys).where(eq(apiKeys.id, kB.id)).catch(() => {});
  });

  assert.equal(await rowEnabled(kB.id), true, 'B key starts enabled');

  // DISABLE — A tries to disable B's key (DoS). Blocked; B's key still enabled.
  await store.setApiKeyEnabled(kB.id, false, A);
  assert.equal(await rowEnabled(kB.id), true, "cross-org disable did NOT disable B's key");

  // Same-org disable persists.
  await store.setApiKeyEnabled(kB.id, false, B);
  assert.equal(await rowEnabled(kB.id), false, 'same-org disable persisted');

  // RATE-LIMIT — A tries to throttle B's key. Blocked; B's limit unchanged (null).
  await rl.setKeyRateLimit(kB.id, 1, A);
  assert.equal(await rl.getKeyRateLimit(kB.id, B), null, "cross-org rate-limit did NOT throttle B's key");
  // Cross-org READ of the limit also misses (returns null, never B's value).
  await rl.setKeyRateLimit(kB.id, 42, B);
  assert.equal(await rl.getKeyRateLimit(kB.id, A), null, "cross-org read cannot see B's limit");
  assert.equal(await rl.getKeyRateLimit(kB.id, B), 42, 'same-org read/set persisted');

  // DELETE — A tries to delete B's key. Blocked; row still present.
  await store.deleteApiKey(kB.id, A);
  assert.notEqual(await rowEnabled(kB.id), undefined, "cross-org delete did NOT remove B's key");

  // Same-org delete removes it.
  await store.deleteApiKey(kB.id, B);
  assert.equal(await rowEnabled(kB.id), undefined, 'same-org delete removed B key');
});

test('masking rules: org A cannot toggle org B rule (P1 IDOR)', { skip }, async (t) => {
  const store = await import('@/lib/store');
  const { db } = await import('@/db');
  const { maskingRules } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  await store.ensureOrgSchema(); // self-heal masking_rules.org_id on a pre-migration DB
  const rB = await store.createMaskingRule('pan', 'mask', B); // enabled defaults true

  t.after(async () => {
    await db.delete(maskingRules).where(eq(maskingRules.id, rB.id)).catch(() => {});
  });

  const enabledOf = async (org: string): Promise<boolean | undefined> =>
    (await store.listMaskingRules(org)).find((r) => r.id === rB.id)?.enabled;

  assert.equal(await enabledOf(B), true, 'B rule starts enabled');

  // A tries to DISABLE B's masking rule (would unmask B's PII). Blocked; still enabled.
  await store.setMaskingRuleEnabled(rB.id, false, A);
  assert.equal(await enabledOf(B), true, "cross-org toggle did NOT disable B's masking rule");

  // Same-org toggle persists.
  await store.setMaskingRuleEnabled(rB.id, false, B);
  assert.equal(await enabledOf(B), false, 'same-org toggle persisted');
});
