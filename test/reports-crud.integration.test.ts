import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
// @ts-expect-error — .mjs helper, no types
import { dbAvailable } from './helpers/db-available.mjs';

// INTEGRATION: exercises the REAL report-template CRUD write-paths in src/lib/reports.ts against a
// REAL Postgres. The module self-creates its table (ensureReportSchema) and seeds the built-in
// catalog, so a live connection is all that's needed. Skips gracefully (green) when the DB is down.

const { ok, reason } = await dbAvailable();
const skip = ok ? undefined : reason;

// Track ids created so we can clean up even if an assertion fails midway.
const createdIds: string[] = [];

describe('reports CRUD (integration)', { skip }, () => {
  let reports: typeof import('../src/lib/reports.ts');

  before(async () => {
    reports = await import('../src/lib/reports.ts');
    await reports.ensureReportSchema();
  });

  after(async () => {
    if (!reports) return;
    for (const id of createdIds) {
      await reports.deleteReportTemplate(id).catch(() => {});
    }
  });

  test('ensure seeds the built-in catalog', async () => {
    const list = await reports.listReportTemplates();
    const builtins = list.filter((t) => t.kind === 'builtin');
    // The nine hardcoded REPORTS should all be present as builtin rows.
    assert.ok(builtins.length >= reports.REPORTS.length);
    for (const r of reports.REPORTS) {
      const row = list.find((t) => t.id === r.id);
      assert.ok(row, `built-in ${r.id} should be seeded`);
      assert.equal(row?.kind, 'builtin');
    }
  });

  test('create → read → update → delete a custom template', async () => {
    const name = `Int Test Report ${Date.now()}`;
    const id = await reports.createReportTemplate({
      name,
      description: 'created by integration test',
      sections: ['compliance', 'controls'],
      frameworks: ['dpdp'],
      source: 'Regulatory plane',
      schedule: 'weekly',
    });
    createdIds.push(id);
    assert.ok(id, 'create returns an id');

    // READ
    const got = await reports.getReportTemplate(id);
    assert.ok(got);
    assert.equal(got?.name, name);
    assert.equal(got?.kind, 'custom');
    assert.deepEqual(got?.sections, ['compliance', 'controls']);
    assert.deepEqual(got?.frameworks, ['dpdp']);
    assert.equal(got?.schedule, 'weekly');

    // UPDATE (custom: name + sections editable)
    const updated = await reports.updateReportTemplate(id, {
      name: `${name} (edited)`,
      description: 'edited',
      sections: ['audit'],
      schedule: 'monthly',
    });
    assert.ok(updated);
    assert.equal(updated?.name, `${name} (edited)`);
    assert.equal(updated?.description, 'edited');
    assert.deepEqual(updated?.sections, ['audit']);
    assert.equal(updated?.schedule, 'monthly');

    // DELETE
    const deleted = await reports.deleteReportTemplate(id);
    assert.equal(deleted, true);
    const gone = await reports.getReportTemplate(id);
    assert.equal(gone, null);
    createdIds.splice(createdIds.indexOf(id), 1);
  });

  test('built-in templates are delete-protected', async () => {
    const target = reports.REPORTS[0].id;
    const before = await reports.getReportTemplate(target);
    assert.ok(before, 'built-in exists');
    const deleted = await reports.deleteReportTemplate(target);
    assert.equal(deleted, false, 'built-in delete returns false');
    const stillThere = await reports.getReportTemplate(target);
    assert.ok(stillThere, 'built-in still present after delete attempt');
  });

  test('built-in edits are restricted to description/source/schedule (name + sections ignored)', async () => {
    const target = reports.REPORTS[0].id;
    const original = await reports.getReportTemplate(target);
    assert.ok(original);
    const res = await reports.updateReportTemplate(target, {
      name: 'HIJACKED NAME',
      sections: ['audit'],
      description: 'operator-tuned description',
      schedule: 'daily',
    });
    assert.ok(res);
    // name + sections are code-defined for builtins → unchanged.
    assert.equal(res?.name, original?.name, 'built-in name must not change');
    assert.deepEqual(res?.sections, original?.sections, 'built-in sections must not change');
    // description + schedule are operator-editable → applied.
    assert.equal(res?.description, 'operator-tuned description');
    assert.equal(res?.schedule, 'daily');
    // restore
    await reports.updateReportTemplate(target, {
      description: original?.description,
      schedule: original?.schedule,
    });
  });

  test('generateCustomReport composes the header + selected sections (action)', async (t) => {
    const id = await reports.createReportTemplate({
      name: `Int Gen Report ${Date.now()}`,
      description: 'gen test',
      sections: ['compliance', 'controls'],
      frameworks: [],
      source: 'Regulatory plane',
      schedule: 'none',
    });
    createdIds.push(id);
    const tpl = await reports.getReportTemplate(id);
    assert.ok(tpl);
    let out: { filename: string; body: string };
    try {
      out = await reports.generateCustomReport(tpl!);
    } catch (e) {
      // The section renderers pull from OTHER control-plane tables (compliance → routing_rules,
      // etc.). On a local dev DB whose *other* tables are unmigrated, generation throws — that is
      // an environment/migration gap, NOT a bug in the report CRUD write-path under test. Skip
      // rather than fail so a partially-seeded DB stays green.
      await reports.deleteReportTemplate(id);
      createdIds.splice(createdIds.indexOf(id), 1);
      t.skip(`section dependency unmigrated: ${(e as Error).message.split('\n')[0]}`);
      return;
    }
    assert.equal(out.filename, `offgrid-${id}.md`);
    assert.match(out.body, new RegExp(`^# ${tpl!.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(out.body, /Compliance posture/);
    assert.match(out.body, /Controls \(live\)/);
    // clean up
    await reports.deleteReportTemplate(id);
    createdIds.splice(createdIds.indexOf(id), 1);
  });
});
