import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the pipeline store — exercises the REAL create → read → update → publish →
// delete write-paths of src/lib/pipelines.ts against a REAL Postgres (the module self-creates both
// tables via ensurePipelinesSchema's CREATE TABLE IF NOT EXISTS). Skips (green) when no DB is up.
// All rows are written under dedicated org ids so real data is never touched. Verifies the core
// invariant: EVERY update + publish writes an immutable version snapshot + bumps the version.

const ORG = 'test-int-pipelines';
const OTHER = 'test-int-pipelines-other';

const dbUp = await dbReachable();

test('pipeline store CRUD + versioning + org scoping against a real Postgres', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const {
    ensurePipelinesSchema,
    createPipeline,
    listPipelines,
    getPipeline,
    updatePipeline,
    publishPipeline,
    deletePipeline,
    listPipelineVersions,
  } = await import('@/lib/pipelines');

  await ensurePipelinesSchema();

  t.after(async () => {
    for (const org of [ORG, OTHER]) {
      for (const p of await listPipelines(org)) await deletePipeline(p.id, org);
    }
  });

  // ── CREATE — writes a v1 snapshot ────────────────────────────────────────────────────────────────
  const kyc = await createPipeline(
    {
      name: 'KYC Verification',
      description: 'validate PAN/Aadhaar',
      gatewayId: 'gw_test',
      dataAllowlist: ['kyc-records', 'customer-master'],
      routing: { egressAllowed: false, rules: [] },
    },
    'owner@x.io',
    ORG,
  );
  assert.match(kyc.id, /^pl_/);
  assert.equal(kyc.version, 1);
  assert.deepEqual(kyc.dataAllowlist, ['kyc-records', 'customer-master']);
  const v1 = await listPipelineVersions(kyc.id, ORG);
  assert.equal(v1.length, 1, 'create wrote one snapshot');
  assert.equal(v1[0].version, 1);
  assert.equal(v1[0].note, 'created');

  // ── UPDATE — bumps version + writes ANOTHER snapshot ─────────────────────────────────────────────
  const updated = await updatePipeline(
    kyc.id,
    { description: 'validate PAN/Aadhaar + address', dataAllowlist: ['kyc-records'] },
    ORG,
    'editor@x.io',
  );
  assert.ok(updated);
  assert.equal(updated.version, 2, 'update bumps the version');
  assert.deepEqual(updated.dataAllowlist, ['kyc-records']);
  const v2 = await listPipelineVersions(kyc.id, ORG);
  assert.equal(v2.length, 2, 'update wrote a second snapshot');
  assert.equal(v2[0].version, 2, 'newest first');
  assert.equal(v2[0].note, 'edited');
  // The v1 snapshot is IMMUTABLE — it still shows the original 2-domain ceiling.
  const oldSnap = v2.find((v) => v.version === 1)!.snapshot as { dataAllowlist?: string[] };
  assert.deepEqual(oldSnap.dataAllowlist, ['kyc-records', 'customer-master'], 'v1 snapshot is frozen');

  // ── PUBLISH — status → published, bump, snapshot ─────────────────────────────────────────────────
  const published = await publishPipeline(kyc.id, ORG, 'admin@x.io');
  assert.ok(published);
  assert.equal(published.status, 'published');
  assert.equal(published.version, 3);
  const v3 = await listPipelineVersions(kyc.id, ORG);
  assert.equal(v3.length, 3);
  assert.equal(v3[0].note, 'published');

  // ── READ (list is org-scoped) ────────────────────────────────────────────────────────────────────
  const listed = await listPipelines(ORG);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'KYC Verification');

  // ── idempotent seed via stable id — a second create with the same id is a no-op ──────────────────
  const seeded = await createPipeline(
    { id: 'pl_seed_test_int', name: 'Seeded', dataAllowlist: ['x'] },
    'owner@x.io',
    ORG,
  );
  const seededAgain = await createPipeline(
    { id: 'pl_seed_test_int', name: 'Seeded (changed)', dataAllowlist: ['y'] },
    'owner@x.io',
    ORG,
  );
  assert.equal(seededAgain.id, seeded.id, 'same stable id returned');
  assert.equal(seededAgain.name, 'Seeded', 'onConflictDoNothing kept the original row');
  assert.equal((await listPipelines(ORG)).length, 2, 'no duplicate created');

  // ── ORG SCOPING — another org never sees these rows ──────────────────────────────────────────────
  assert.equal((await listPipelines(OTHER)).length, 0, 'other org is empty');
  assert.equal(await getPipeline(kyc.id, OTHER), null, 'cross-org get misses');
  assert.ok(await getPipeline(kyc.id, ORG), 'same-org get hits');
  assert.equal(await updatePipeline(kyc.id, { name: 'hijack' }, OTHER, 'x'), null, 'cross-org update misses');
  assert.equal((await listPipelineVersions(kyc.id, OTHER)).length, 0, 'cross-org versions miss');

  // ── DELETE — org-scoped; removes version history too ─────────────────────────────────────────────
  assert.equal(await deletePipeline(kyc.id, OTHER), false, 'cross-org delete misses');
  assert.equal(await deletePipeline(kyc.id, ORG), true);
  assert.equal((await listPipelines(ORG)).length, 1, 'gone after delete');
  assert.equal((await listPipelineVersions(kyc.id, ORG)).length, 0, 'versions cleaned up');
  assert.equal(await deletePipeline(kyc.id, ORG), false, 'second delete misses');
});
