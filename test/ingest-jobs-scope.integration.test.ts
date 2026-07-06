import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for ingest-job tenant scoping (P1 — HARDENING_AUDIT.md). Exercises the REAL
// store against a REAL Postgres: a connector in org A and one in org B, each synced, and asserts
// listIngestJobs(org) only returns THAT org's jobs — never the other tenant's. Skips green if the
// DB is down. Rows are written under dedicated org ids so real data is never touched.

const ORG_A = 'test-int-ingest-a';
const ORG_B = 'test-int-ingest-b';

const dbUp = await dbReachable();

test('listIngestJobs is scoped to the org — no cross-tenant leak', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { createConnector, syncConnector, listIngestJobs } = await import('@/lib/store');
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');

  const conA = await createConnector({ name: 'A-src', type: 'http', orgId: ORG_A });
  const conB = await createConnector({ name: 'B-src', type: 'http', orgId: ORG_B });

  t.after(async () => {
    await db.execute(sql`DELETE FROM ingest_jobs WHERE org_id IN (${ORG_A}, ${ORG_B})`);
    await db.execute(sql`DELETE FROM connectors WHERE org_id IN (${ORG_A}, ${ORG_B})`);
  });

  const jobA = await syncConnector(conA.id);
  const jobB = await syncConnector(conB.id);
  assert.ok(jobA, 'sync A produced a job');
  assert.ok(jobB, 'sync B produced a job');

  const listA = await listIngestJobs(ORG_A);
  const listB = await listIngestJobs(ORG_B);

  // Org A sees ONLY its job; org B's job never leaks into A's list (and vice-versa).
  assert.ok(listA.some((j) => j.id === jobA.id), "org A sees its own job");
  assert.ok(!listA.some((j) => j.id === jobB.id), "org A must NOT see org B's job");
  assert.ok(listB.some((j) => j.id === jobB.id), "org B sees its own job");
  assert.ok(!listB.some((j) => j.id === jobA.id), "org B must NOT see org A's job");
});

test('enrollDevice mints a random per-device token verified by the pure verifier', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { createEnrollmentToken, enrollDevice, getDeviceToken } = await import('@/lib/store');
  const { verifyDeviceToken, legacyDeviceToken } = await import('@/lib/device-token.ts');
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');

  const enr = await createEnrollmentToken('worker');
  const enrolled = await enrollDevice(enr.token, 'int-test-node', 'macOS');
  assert.ok(enrolled, 'enroll succeeded');

  t.after(async () => {
    await db.execute(sql`DELETE FROM devices WHERE id = ${enrolled.device.id}`);
    await db.execute(sql`DELETE FROM enrollment_tokens WHERE token = ${enr.token}`);
  });

  // The minted token is random (not the predictable dt_<id>) and is what the row stores.
  assert.notEqual(enrolled.deviceToken, legacyDeviceToken(enrolled.device.id));
  const stored = await getDeviceToken(enrolled.device.id);
  assert.equal(stored, enrolled.deviceToken);

  // The stored secret authenticates; the legacy form no longer does (upgrade closes it).
  assert.equal(verifyDeviceToken(enrolled.device.id, enrolled.deviceToken, stored), true);
  assert.equal(verifyDeviceToken(enrolled.device.id, legacyDeviceToken(enrolled.device.id), stored), false);
});
