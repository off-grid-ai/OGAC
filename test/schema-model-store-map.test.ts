import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapModelRow, mapVersionRow } from '../src/lib/schema-model-store.ts';

test('mapModelRow: snake→camel, defaults, date→iso', () => {
  const d = new Date('2026-07-21T10:00:00.000Z');
  const m = mapModelRow({
    id: 'wm_1',
    org_id: 'bharatunion',
    name: 'loan_by_branch',
    database: 'bharatunion',
    kind: 'view',
    current_version: 3,
    created_at: d,
    updated_at: '2026-07-21T11:00:00Z',
  });
  assert.equal(m.id, 'wm_1');
  assert.equal(m.orgId, 'bharatunion');
  assert.equal(m.kind, 'view');
  assert.equal(m.currentVersion, 3);
  assert.equal(m.database, 'bharatunion');
  assert.equal(m.createdAt, '2026-07-21T10:00:00.000Z');
  assert.equal(m.updatedAt, '2026-07-21T11:00:00Z');
});

test('mapModelRow: defensive defaults on sparse row', () => {
  const m = mapModelRow({ id: 'wm_2' });
  assert.equal(m.orgId, 'default');
  assert.equal(m.name, '');
  assert.equal(m.database, null);
  assert.equal(m.kind, 'view');
  assert.equal(m.currentVersion, 1);
  assert.equal(m.createdAt, '');
});

test('mapVersionRow: jsonb definition + apply_ddl array', () => {
  const v = mapVersionRow({
    id: 'wmv_1',
    model_id: 'wm_1',
    version: 2,
    definition: { selectSql: 'SELECT 1' },
    apply_ddl: ['CREATE OR REPLACE VIEW `v` AS SELECT 1'],
    note: 'edit',
    created_at: '2026-07-21T10:00:00Z',
  });
  assert.equal(v.version, 2);
  assert.deepEqual(v.definition, { selectSql: 'SELECT 1' });
  assert.equal(v.applyDdl.length, 1);
  assert.equal(v.note, 'edit');
});

test('mapVersionRow: defensive on junk definition/ddl', () => {
  const v = mapVersionRow({ id: 'wmv_2', model_id: 'wm_1', version: 'x', definition: null, apply_ddl: 'nope', note: null });
  assert.equal(v.version, 1); // NaN → 1
  assert.deepEqual(v.definition, {});
  assert.deepEqual(v.applyDdl, []);
  assert.equal(v.note, null);
});
