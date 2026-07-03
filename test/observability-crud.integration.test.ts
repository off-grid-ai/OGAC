import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
// @ts-expect-error — .mjs helper, no types
import { dbAvailable } from './helpers/db-available.mjs';

// INTEGRATION: exercises the REAL observability threshold CRUD + baseline reset action in
// src/lib/observability-settings.ts against a REAL Postgres. Tables self-create via
// ensureObservabilitySchema. Skips gracefully (green) when the DB is down.

const { ok, reason } = await dbAvailable();
const skip = ok ? undefined : reason;

const CREATED_BY = 'test-int-observability';
const thresholdIds: string[] = [];

describe('observability thresholds + baseline (integration)', { skip }, () => {
  let mod: typeof import('../src/lib/observability-settings.ts');

  before(async () => {
    mod = await import('../src/lib/observability-settings.ts');
    await mod.ensureObservabilitySchema();
  });

  after(async () => {
    if (!mod) return;
    for (const id of thresholdIds) await mod.deleteThreshold(id).catch(() => {});
  });

  test('threshold: create → read → update → delete', async () => {
    const created = await mod.createThreshold(
      { metric: 'drift_score', op: 'gt', value: 0.3, severity: 'warning' },
      CREATED_BY,
    );
    assert.equal(created.ok, true);
    assert.ok(created.id);
    thresholdIds.push(created.id!);

    // READ via list
    const list = await mod.listThresholds();
    const row = list.find((t) => t.id === created.id);
    assert.ok(row);
    assert.equal(row?.metric, 'drift_score');
    assert.equal(row?.op, 'gt');
    assert.equal(row?.value, 0.3);
    assert.equal(row?.severity, 'warning');
    assert.equal(row?.createdBy, CREATED_BY);

    // UPDATE (full replacement, re-validated)
    const upd = await mod.updateThreshold(created.id!, {
      metric: 'eval_pass_rate',
      op: 'lt',
      value: 0.8,
      severity: 'critical',
    });
    assert.equal(upd.ok, true);
    const after = (await mod.listThresholds()).find((t) => t.id === created.id);
    assert.equal(after?.metric, 'eval_pass_rate');
    assert.equal(after?.op, 'lt');
    assert.equal(after?.value, 0.8);
    assert.equal(after?.severity, 'critical');

    // DELETE
    await mod.deleteThreshold(created.id!);
    const gone = (await mod.listThresholds()).find((t) => t.id === created.id);
    assert.equal(gone, undefined);
    thresholdIds.splice(thresholdIds.indexOf(created.id!), 1);
  });

  test('createThreshold rejects invalid input via the pure validator (no row written)', async () => {
    const before = (await mod.listThresholds()).length;
    const badMetric = await mod.createThreshold(
      { metric: 'bogus', op: 'gt', value: 0.5 },
      CREATED_BY,
    );
    assert.equal(badMetric.ok, false);
    assert.ok(badMetric.error);

    const outOfRange = await mod.createThreshold(
      { metric: 'drift_score', op: 'gt', value: 5 },
      CREATED_BY,
    );
    assert.equal(outOfRange.ok, false);
    assert.match(outOfRange.error ?? '', /between 0 and 1/);

    const after = (await mod.listThresholds()).length;
    assert.equal(after, before, 'invalid input must not persist a row');
  });

  test('baseline reset action: getBaseline → resetBaseline → getBaseline (upsert singleton)', async () => {
    const first = await mod.resetBaseline(CREATED_BY, 'first reset');
    assert.equal(first, undefined); // returns void
    const b1 = await mod.getBaseline();
    assert.ok(b1);
    assert.equal(b1?.resetBy, CREATED_BY);
    assert.equal(b1?.note, 'first reset');
    assert.ok(!Number.isNaN(Date.parse(b1!.resetAt)));

    // Second reset upserts the singleton 'current' row (no duplicate).
    await mod.resetBaseline('someone-else', 'second reset');
    const b2 = await mod.getBaseline();
    assert.equal(b2?.resetBy, 'someone-else');
    assert.equal(b2?.note, 'second reset');
    assert.ok(Date.parse(b2!.resetAt) >= Date.parse(b1!.resetAt));
  });
});
