import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
// @ts-expect-error — .mjs helper, no types
import { dbAvailable } from './helpers/db-available.mjs';

// INTEGRATION: exercises the REAL saved-metric-query CRUD in src/lib/vm-saved-queries-store.ts
// against a REAL Postgres. The table self-creates via ensureVmSavedQueriesSchema. We assert the
// terminal artifact (the persisted row) and the tenant-isolation invariant: another org's id
// matches no row. Skips gracefully (green) when the DB is down.

const { ok, reason } = await dbAvailable();
const skip = ok ? undefined : reason;

const CREATED_BY = 'test-int-vmsq';
const ORG_A = 'test-vmsq-org-a';
const ORG_B = 'test-vmsq-org-b';
const ids: Array<[string, string]> = []; // [id, org]

describe('vm saved queries CRUD (integration)', { skip }, () => {
  let mod: typeof import('../src/lib/vm-saved-queries-store.ts');

  before(async () => {
    mod = await import('../src/lib/vm-saved-queries-store.ts');
    await mod.ensureVmSavedQueriesSchema();
  });

  after(async () => {
    if (!mod) return;
    for (const [id, org] of ids) await mod.deleteSavedQuery(id, org).catch(() => {});
  });

  test('create → read → update → delete', async () => {
    const created = await mod.createSavedQuery(
      {
        name: 'gateway error rate',
        query: 'sum(rate(otelcol_exporter_send_failed_spans_total[5m]))',
        range: '6h',
        description: 'export failures over 6h',
      },
      CREATED_BY,
      ORG_A,
    );
    ids.push([created.id, ORG_A]);
    assert.ok(created.id);
    assert.equal(created.name, 'gateway error rate');
    assert.equal(created.range, '6h');
    assert.equal(created.createdBy, CREATED_BY);

    // READ (list + get)
    const list = await mod.listSavedQueries(ORG_A);
    assert.ok(list.find((q) => q.id === created.id));
    const got = await mod.getSavedQuery(created.id, ORG_A);
    assert.equal(got?.description, 'export failures over 6h');

    // UPDATE
    const updated = await mod.updateSavedQuery(
      created.id,
      { name: 'gateway errors', query: 'up', range: '1h', description: '' },
      ORG_A,
    );
    assert.equal(updated?.name, 'gateway errors');
    assert.equal(updated?.query, 'up');
    assert.equal(updated?.range, '1h');

    // DELETE returns true, then the row is gone
    assert.equal(await mod.deleteSavedQuery(created.id, ORG_A), true);
    assert.equal(await mod.getSavedQuery(created.id, ORG_A), null);
  });

  test('tenant isolation: another org cannot read/update/delete by guessed id', async () => {
    const created = await mod.createSavedQuery(
      { name: 'private', query: 'up', range: '1h', description: '' },
      CREATED_BY,
      ORG_A,
    );
    ids.push([created.id, ORG_A]);

    // ORG_B sees nothing and cannot reach the row
    assert.equal(await mod.getSavedQuery(created.id, ORG_B), null);
    assert.equal(await mod.updateSavedQuery(created.id, { name: 'x', query: 'up', range: '1h', description: '' }, ORG_B), null);
    assert.equal(await mod.deleteSavedQuery(created.id, ORG_B), false);
    assert.equal(await mod.listSavedQueries(ORG_B).then((l) => l.find((q) => q.id === created.id)), undefined);

    // ORG_A still owns it
    assert.ok(await mod.getSavedQuery(created.id, ORG_A));
  });

  test('update of a non-existent id returns null', async () => {
    const missing = await mod.updateSavedQuery(
      'nope-does-not-exist',
      { name: 'x', query: 'up', range: '1h', description: '' },
      ORG_A,
    );
    assert.equal(missing, null);
  });
});
