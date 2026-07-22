import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION tests for the analytical-model store I/O against a REAL Postgres, no mocks. Exercises the
// full governed warehouse-model lifecycle the console owns (ClickHouse holds the live object; this store
// holds the versioned definitions + exact DDL so an edit is a new version and a rollback re-points an
// older one):
//   • createModel → getModel (detail carries v1 + its applyDdl) ;
//   • listModels is org-scoped (never leaks a sibling org's model) ;
//   • addModelVersion bumps current_version + appends a version row ;
//   • setCurrentVersion moves the pointer (the rollback primitive) ;
//   • getModel(unknown) → null, and deleteModel cascades versions + is idempotent-false on a second call.
// Skips (green) when no DB is up. Tracks + deletes only the ids it creates.

const dbUp = await dbReachable();

test('analytical-model store lifecycle (real Postgres)', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const {
    createModel,
    getModel,
    listModels,
    addModelVersion,
    setCurrentVersion,
    deleteModel,
  } = await import('@/lib/schema-model-store');

  const marker = `sm-${Date.now()}`;
  const orgId = `org-${marker}`;
  const otherOrg = `org-other-${marker}`;

  // ── create v1 (a view over the Suraksha Life claims warehouse table) ──
  const created = await createModel(
    {
      name: `${marker}_claims_daily`,
      database: 'offgrid_warehouse',
      kind: 'view',
      definition: { selectSql: 'SELECT toDate(filed_at) d, count() n FROM claims GROUP BY d' },
      applyDdl: ['CREATE VIEW claims_daily AS SELECT toDate(filed_at) d, count() n FROM claims GROUP BY d'],
      note: 'initial view',
    },
    orgId,
  );
  t.after(async () => {
    await deleteModel(created.id, orgId).catch(() => {});
  });
  assert.match(created.id, /^wm_/);
  assert.equal(created.currentVersion, 1);
  assert.equal(created.kind, 'view');

  // getModel returns the detail with exactly v1 + its frozen DDL
  const d1 = await getModel(created.id, orgId);
  assert.ok(d1, 'model readable');
  assert.equal(d1!.versions.length, 1);
  assert.equal(d1!.versions[0].version, 1);
  assert.deepEqual(d1!.versions[0].applyDdl, [
    'CREATE VIEW claims_daily AS SELECT toDate(filed_at) d, count() n FROM claims GROUP BY d',
  ]);

  // listModels is ORG-SCOPED — a sibling org never sees this model
  const mine = await listModels(orgId);
  assert.ok(mine.some((m) => m.id === created.id), 'own org lists it');
  const theirs = await listModels(otherOrg);
  assert.ok(!theirs.some((m) => m.id === created.id), 'sibling org does NOT see it');

  // ── edit → v2 (widen the view); current_version bumps, a v2 row is appended ──
  const v2 = await addModelVersion(
    created.id,
    2,
    { selectSql: 'SELECT toDate(filed_at) d, count() n, sum(amount) amt FROM claims GROUP BY d' },
    ['CREATE OR REPLACE VIEW claims_daily AS SELECT toDate(filed_at) d, count() n, sum(amount) amt FROM claims GROUP BY d'],
    'add amount',
    orgId,
  );
  assert.ok(v2);
  assert.equal(v2!.currentVersion, 2);
  const d2 = await getModel(created.id, orgId);
  assert.equal(d2!.versions.length, 2);
  assert.equal(d2!.versions[0].version, 2, 'newest version first');

  // ── rollback: move the current pointer back to v1 ──
  const rolled = await setCurrentVersion(created.id, 1, orgId);
  assert.ok(rolled);
  assert.equal(rolled!.currentVersion, 1, 'pointer moved back to v1');

  // honest nulls: unknown id, and a version bump / pointer move on an unknown id
  assert.equal(await getModel('wm_does_not_exist', orgId), null);
  assert.equal(await addModelVersion('wm_does_not_exist', 2, { selectSql: 'x' }, [], undefined, orgId), null);
  assert.equal(await setCurrentVersion('wm_does_not_exist', 1, orgId), null);

  // ── delete cascades versions + is idempotent-false on a second call ──
  assert.equal(await deleteModel(created.id, orgId), true);
  assert.equal(await getModel(created.id, orgId), null, 'gone after delete');
  assert.equal(await deleteModel(created.id, orgId), false, 'second delete → false (nothing to remove)');
});
