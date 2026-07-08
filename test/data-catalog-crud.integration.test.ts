import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the M4 data-governance store against a REAL Postgres. Exercises catalog CRUD,
// classification persistence + posture derivation, retention upsert, RTBF request recording, and
// strict org-scoping (no cross-tenant leak). Rows are written under dedicated org ids so real data is
// never touched. Skips green if the DB is down.

const ORG_A = 'test-int-datagov-a';
const ORG_B = 'test-int-datagov-b';

const dbUp = await dbReachable();

test('data-governance store: CRUD + classification + retention + org-scoping', {
  skip: dbUp ? false : SKIP_MESSAGE,
}, async (t) => {
  const store = await import('@/lib/data-catalog-store');
  const { db } = await import('@/db');
  const { sql } = await import('drizzle-orm');

  t.after(async () => {
    for (const org of [ORG_A, ORG_B]) {
      await db.execute(sql`DELETE FROM data_classifications WHERE org_id = ${org}`);
      await db.execute(sql`DELETE FROM retention_policies WHERE org_id = ${org}`);
      await db.execute(sql`DELETE FROM erasure_requests WHERE org_id = ${org}`);
      await db.execute(sql`DELETE FROM data_assets WHERE org_id = ${org}`);
    }
  });

  // ── CREATE ──────────────────────────────────────────────────────────────────
  const a = await store.createAsset(
    { name: 'Customer master', source: 'Core Bank (postgres)', kind: 'table', owner: 'ops@bank.in', rowCount: 1200, freshnessSlaHours: 24 },
    ORG_A,
  );
  assert.match(a.id, /^da_/);
  assert.equal(a.orgId, ORG_A);
  assert.equal(a.freshnessSlaHours, 24);

  // ── READ (org-scoped) ─────────────────────────────────────────────────────────
  const listA = await store.listAssets(ORG_A);
  assert.equal(listA.length, 1);
  assert.equal(listA[0].id, a.id);
  assert.equal((await store.getAsset(a.id, ORG_B)), null, 'org B cannot read org A asset');

  // ── UPDATE ──────────────────────────────────────────────────────────────────
  const updated = await store.updateAsset(a.id, { owner: 'risk@bank.in', rowCount: 1500 }, ORG_A);
  assert.equal(updated?.owner, 'risk@bank.in');
  assert.equal(updated?.rowCount, 1500);
  assert.equal(updated?.name, 'Customer master', 'unspecified fields preserved');
  assert.equal(await store.updateAsset(a.id, { owner: 'x' }, ORG_B), null, 'org B cannot update org A asset');

  // ── CLASSIFICATION persist + posture ──────────────────────────────────────────
  await store.setClassification(a.id, { column: null, level: 'internal', piiTags: [] }, ORG_A);
  await store.setClassification(a.id, { column: 'pan_number', level: 'restricted', piiTags: ['PAN'] }, ORG_A);
  // Re-setting the same column UPDATES rather than duplicating.
  await store.setClassification(a.id, { column: 'pan_number', level: 'restricted', piiTags: ['PAN', 'EMAIL'] }, ORG_A);
  const cls = await store.listClassifications(a.id, ORG_A);
  assert.equal(cls.length, 2, 'asset default + one column (no dup)');
  const posture = await store.assetPosture(a.id, ORG_A);
  assert.equal(posture.effectiveLevel, 'restricted');
  assert.equal(posture.hasPii, true);
  assert.ok(posture.piiTags.includes('PAN') && posture.piiTags.includes('EMAIL'));
  assert.equal(posture.egressAllowed, false);

  // ── RETENTION upsert ──────────────────────────────────────────────────────────
  const rp = await store.setRetention(a.id, { retainDays: 2555, action: 'archive', legalHold: false, note: 'RBI 7yr' }, ORG_A);
  assert.equal(rp.retainDays, 2555);
  assert.equal(rp.action, 'archive');
  const rp2 = await store.setRetention(a.id, { retainDays: 3650, action: 'delete' }, ORG_A);
  assert.equal((await store.listRetentionPolicies(ORG_A)).length, 1, 'one policy per asset (upsert)');
  assert.equal(rp2.retainDays, 3650);

  // ── ORG-SCOPING: org B has its own asset, sees nothing of A ────────────────────
  const b = await store.createAsset({ name: 'B ledger', source: 'B-src' }, ORG_B);
  const listB = await store.listAssets(ORG_B);
  assert.equal(listB.length, 1);
  assert.equal(listB[0].id, b.id);
  assert.ok(!listB.some((x) => x.id === a.id), 'org B must NOT see org A asset');
  assert.equal((await store.listAllClassifications(ORG_B)).length, 0, 'no cross-org classification leak');
  assert.equal((await store.listRetentionPolicies(ORG_B)).length, 0, 'no cross-org retention leak');

  // ── RTBF request record ───────────────────────────────────────────────────────
  const req = await store.recordErasureRequest(
    { subject: 'alice@customer.in', status: 'completed', erasedRows: 4, requestedBy: 'ops@bank.in', scope: { immediateCount: 4 } },
    ORG_A,
  );
  assert.match(req.id, /^er_/);
  const reqs = await store.listErasureRequests(ORG_A);
  assert.equal(reqs.length, 1);
  assert.equal((await store.listErasureRequests(ORG_B)).length, 0, 'no cross-org erasure-request leak');

  // ── DELETE cascades classification + retention ─────────────────────────────────
  assert.equal(await store.deleteAsset(a.id, ORG_B), false, 'org B cannot delete org A asset');
  assert.equal(await store.deleteAsset(a.id, ORG_A), true);
  assert.equal((await store.listAssets(ORG_A)).length, 0);
  assert.equal((await store.listClassifications(a.id, ORG_A)).length, 0, 'classifications removed with asset');
  assert.equal((await store.listRetentionPolicies(ORG_A)).length, 0, 'retention removed with asset');
});
