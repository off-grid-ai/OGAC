import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  diffMigratedSchema,
  formatSchemaDiff,
  isMigrationSchemaComplete,
} from '../scripts/lib/migration-schema-diff.mjs';

// The pure half of the migration-drift gate (scripts/verify-migration-schema.mjs). It exists because
// `drizzle-kit generate` diffs schema.ts against its OWN snapshot and so cannot see a table that
// db:push created in a database but never wrote a migration for — the drift that made 148 integration
// tests unrunnable in CI. These cases run against the REAL committed snapshot, not a fixture.

const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
const latestIdx = journal.entries.at(-1).idx as number;
const snapshot = JSON.parse(
  readFileSync(`drizzle/meta/${String(latestIdx).padStart(4, '0')}_snapshot.json`, 'utf8'),
);

/** The information_schema.columns rows a database would return if it matched the snapshot exactly. */
function columnsMatchingSnapshot(): Array<{ table_name: string; column_name: string }> {
  const rows: Array<{ table_name: string; column_name: string }> = [];
  for (const table of Object.values(snapshot.tables) as Array<{
    name: string;
    columns: Record<string, unknown>;
  }>) {
    for (const column of Object.keys(table.columns)) {
      rows.push({ table_name: table.name, column_name: column });
    }
  }
  return rows;
}

test('the committed snapshot describes a real schema the diff can reason about', () => {
  const tables = Object.values(snapshot.tables) as Array<{ name: string }>;
  assert.ok(tables.length > 50, `expected the console schema, got ${tables.length} tables`);
  assert.ok(tables.some((t) => t.name === 'teams'));
  assert.ok(tables.some((t) => t.name === 'pipelines'));
});

test('a database matching the snapshot reports no drift', () => {
  const diff = diffMigratedSchema(snapshot, columnsMatchingSnapshot());
  assert.deepEqual(diff.missingTables, []);
  assert.deepEqual(diff.missingColumns, []);
  assert.deepEqual(diff.extraTables, []);
  assert.equal(diff.declaredTables, Object.keys(snapshot.tables).length);
  assert.equal(isMigrationSchemaComplete(diff), true);
  assert.match(formatSchemaDiff(diff), /^OK — all \d+ tables declared/m);
});

test('a table the migrations never create is reported as MISSING, not silently tolerated', () => {
  // The exact shape of the real defect: `teams` existed in the snapshot (db:push wrote it there) and
  // in no migration, so a migration-built database had no such table.
  const rows = columnsMatchingSnapshot().filter((r) => r.table_name !== 'teams');
  const diff = diffMigratedSchema(snapshot, rows);
  assert.deepEqual(diff.missingTables, ['teams']);
  assert.deepEqual(diff.missingColumns, []);
  assert.equal(isMigrationSchemaComplete(diff), false);
  assert.match(formatSchemaDiff(diff), /MISSING TABLE {3}teams/);
  assert.match(formatSchemaDiff(diff), /DRIFT — 1 missing table\(s\), 0 missing column\(s\)/);
});

test('a column the migrations never add is reported per table.column', () => {
  // `app_runs.data_classification` — the failure the integration suites actually hit.
  const rows = columnsMatchingSnapshot().filter(
    (r) => !(r.table_name === 'app_runs' && r.column_name === 'data_classification'),
  );
  const diff = diffMigratedSchema(snapshot, rows);
  assert.deepEqual(diff.missingTables, []);
  assert.deepEqual(diff.missingColumns, ['app_runs.data_classification']);
  assert.equal(isMigrationSchemaComplete(diff), false);
  assert.match(formatSchemaDiff(diff), /MISSING COLUMN {2}app_runs\.data_classification/);
});

test('missing tables and columns are both reported, sorted, in one pass', () => {
  const rows = columnsMatchingSnapshot().filter(
    (r) =>
      r.table_name !== 'teams' &&
      r.table_name !== 'pipelines' &&
      !(r.table_name === 'user' && r.column_name === 'org_id') &&
      !(r.table_name === 'apps' && r.column_name === 'pipeline_id'),
  );
  const diff = diffMigratedSchema(snapshot, rows);
  assert.deepEqual(diff.missingTables, ['pipelines', 'teams']);
  assert.deepEqual(diff.missingColumns, ['apps.pipeline_id', 'user.org_id']);
});

test("drizzle's own bookkeeping table is not drift", () => {
  const rows = [
    ...columnsMatchingSnapshot(),
    { table_name: '__drizzle_migrations', column_name: 'hash' },
  ];
  const diff = diffMigratedSchema(snapshot, rows);
  assert.deepEqual(diff.extraTables, []);
  assert.equal(isMigrationSchemaComplete(diff), true);
});

test('an extra table is REPORTED but does not fail the gate — dropping it would be destructive', () => {
  const rows = [...columnsMatchingSnapshot(), { table_name: 'retired_audit_v1', column_name: 'id' }];
  const diff = diffMigratedSchema(snapshot, rows);
  assert.deepEqual(diff.extraTables, ['retired_audit_v1']);
  assert.equal(isMigrationSchemaComplete(diff), true);
  assert.match(formatSchemaDiff(diff), /extra table {5}retired_audit_v1 .*advisory/);
});

test('an empty database reports every declared table as missing', () => {
  const diff = diffMigratedSchema(snapshot, []);
  assert.equal(diff.missingTables.length, Object.keys(snapshot.tables).length);
  assert.deepEqual(diff.missingColumns, []);
  assert.equal(isMigrationSchemaComplete(diff), false);
});

test('a snapshot with no tables at all is handled without throwing', () => {
  const diff = diffMigratedSchema({ tables: {} }, [{ table_name: 'x', column_name: 'id' }]);
  assert.deepEqual(diff.missingTables, []);
  assert.deepEqual(diff.extraTables, ['x']);
  assert.equal(diff.declaredTables, 0);
  assert.equal(isMigrationSchemaComplete(diff), true);
});

test('a table declared with no columns still has to exist', () => {
  const diff = diffMigratedSchema({ tables: { 'public.t': { name: 't' } } }, []);
  assert.deepEqual(diff.missingTables, ['t']);
});
