import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the analytical-model SERVICE against a REAL Postgres store. The only stub is
// at the external DEVICE BOUNDARY — the ClickHouse warehouse port — which we can't reach from here;
// the store, the pure plans, and the whole apply→record sequencing run for real. Proves:
//   • createModelLive applies the built DDL to the warehouse THEN records v1 with that exact DDL ;
//   • a warehouse failure on create records NOTHING (fail-closed — no orphan version row) ;
//   • editModelLive re-applies + appends v2, bumping current_version ;
//   • rollbackModelLive re-applies a prior version's FROZEN DDL + moves the pointer back ;
//   • deleteModelLive drops in the warehouse then removes the store rows ;
//   • invalid definitions never reach the warehouse.
// Skips (green) when no DB is up. Tracks + deletes only the ids it creates.

const dbUp = await dbReachable();

// A recording stub for the warehouse port — captures every DDL statement it's asked to run and can
// be told to reject (simulating a ClickHouse error) so we can assert fail-closed ordering.
function stubWarehouse(opts: { fail?: boolean } = {}) {
  const ran: string[][] = [];
  const port = {
    meta: { id: 'stub', capability: 'bi', vendor: 'stub', render: 'native' as const },
    async health() {
      return true;
    },
    async listTables() {
      return [];
    },
    async tableStats() {
      return null;
    },
    async sample() {
      return null;
    },
    async query() {
      return { ok: false as const, reason: 'not used' };
    },
    async execDdl(statements: string[]) {
      ran.push(statements);
      return opts.fail
        ? { ok: false as const, reason: 'clickhouse 500: simulated' }
        : { ok: true as const };
    },
  };
  return { port, ran };
}

test('analytical-model service lifecycle (real Postgres + stub warehouse)', {
  skip: dbUp ? false : SKIP_MESSAGE,
}, async (t) => {
  const {
    createModelLive,
    editModelLive,
    rollbackModelLive,
    deleteModelLive,
  } = await import('@/lib/warehouse-model-service');
  const { getModel, deleteModel } = await import('@/lib/schema-model-store');

  const marker = `svc_${Date.now()}`;
  const orgId = `org-${marker}`;
  const name = `${marker}_claims_daily`;
  let createdId = '';
  t.after(async () => {
    if (createdId) await deleteModel(createdId, orgId).catch(() => {});
  });

  // ── create v1: DDL hits the warehouse, then v1 is recorded with that DDL ──
  const wh = stubWarehouse();
  const created = await createModelLive(
    {
      name,
      kind: 'view',
      database: 'suraksha_warehouse',
      definition: { selectSql: 'SELECT toDate(filed_at) d, count() n FROM claims GROUP BY d' },
      note: 'initial view',
    },
    orgId,
    wh.port,
  );
  assert.equal(created.ok, true);
  createdId = created.ok ? created.value.id : '';
  assert.equal(wh.ran.length, 1, 'DDL applied exactly once');
  assert.deepEqual(wh.ran[0], [
    'CREATE OR REPLACE VIEW `suraksha_warehouse`.`' + name + '` AS SELECT toDate(filed_at) d, count() n FROM claims GROUP BY d',
  ]);
  const d1 = created.ok ? created.value : null;
  assert.equal(d1!.currentVersion, 1);
  assert.deepEqual(d1!.versions[0].applyDdl, wh.ran[0], 'store froze the exact applied DDL');

  // ── invalid definition never reaches the warehouse ──
  const whBad = stubWarehouse();
  const bad = await editModelLive(createdId, { selectSql: 'DROP TABLE claims' }, 'nope', orgId, whBad.port);
  assert.equal(bad.ok, false);
  assert.equal(bad.ok === false && bad.kind, 'invalid');
  assert.equal(whBad.ran.length, 0, 'invalid DDL never sent to the warehouse');

  // ── edit → v2 ──
  const wh2 = stubWarehouse();
  const edited = await editModelLive(
    createdId,
    { selectSql: 'SELECT toDate(filed_at) d, count() n, sum(amount) amt FROM claims GROUP BY d' },
    'add amount',
    orgId,
    wh2.port,
  );
  assert.equal(edited.ok, true);
  assert.equal(edited.ok && edited.value.currentVersion, 2);
  assert.equal(wh2.ran.length, 1);
  const d2 = await getModel(createdId, orgId);
  assert.equal(d2!.versions.length, 2);

  // ── rollback to v1: re-applies v1's FROZEN DDL, pointer moves back ──
  const wh3 = stubWarehouse();
  const rolled = await rollbackModelLive(createdId, 1, orgId, wh3.port);
  assert.equal(rolled.ok, true);
  assert.equal(rolled.ok && rolled.value.currentVersion, 1, 'pointer back to v1');
  assert.deepEqual(wh3.ran[0], d1!.versions[0].applyDdl, 're-applied v1 frozen DDL');
  // trail preserved — v2 still exists
  assert.equal((await getModel(createdId, orgId))!.versions.length, 2);

  // rollback to an unknown version is rejected, warehouse untouched
  const whUnknown = stubWarehouse();
  const badRoll = await rollbackModelLive(createdId, 99, orgId, whUnknown.port);
  assert.equal(badRoll.ok, false);
  assert.equal(whUnknown.ran.length, 0);

  // ── delete: drop in warehouse THEN remove store rows ──
  const wh4 = stubWarehouse();
  const del = await deleteModelLive(createdId, orgId, wh4.port);
  assert.equal(del.ok, true);
  assert.deepEqual(wh4.ran[0], ['DROP VIEW IF EXISTS `suraksha_warehouse`.`' + name + '`']);
  assert.equal(await getModel(createdId, orgId), null, 'store rows gone');
  createdId = '';
});

test('createModelLive fail-closed: warehouse rejects → nothing recorded', {
  skip: dbUp ? false : SKIP_MESSAGE,
}, async () => {
  const { createModelLive } = await import('@/lib/warehouse-model-service');
  const { listModels } = await import('@/lib/schema-model-store');

  const marker = `svcfail_${Date.now()}`;
  const orgId = `org-${marker}`;
  const wh = stubWarehouse({ fail: true });
  const res = await createModelLive(
    { name: `${marker}_v`, kind: 'view', definition: { selectSql: 'SELECT 1' } },
    orgId,
    wh.port,
  );
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.kind, 'warehouse');
  assert.equal(wh.ran.length, 1, 'DDL was attempted');
  const models = await listModels(orgId);
  assert.equal(models.length, 0, 'no orphan model row when the DDL failed');
});

test('edit/rollback/delete on unknown model → not_found, warehouse untouched', {
  skip: dbUp ? false : SKIP_MESSAGE,
}, async () => {
  const { editModelLive, rollbackModelLive, deleteModelLive } = await import(
    '@/lib/warehouse-model-service'
  );
  const wh = stubWarehouse();
  const e = await editModelLive('wm_nope', { selectSql: 'SELECT 1' }, undefined, 'org-x', wh.port);
  assert.equal(e.ok === false && e.kind, 'not_found');
  const r = await rollbackModelLive('wm_nope', 1, 'org-x', wh.port);
  assert.equal(r.ok === false && r.kind, 'not_found');
  const d = await deleteModelLive('wm_nope', 'org-x', wh.port);
  assert.equal(d.ok === false && d.kind, 'not_found');
  assert.equal(wh.ran.length, 0, 'no model → never touch the warehouse');
});
