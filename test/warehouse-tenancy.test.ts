import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALL_DATABASES,
  scopeTablesToDatabase,
  tableInScope,
  warehouseDatabaseForSlug,
} from '../src/lib/warehouse-tenancy.ts';

// Pure tenancy rules for the warehouse read path (G-ADV-DATA-5 fix): a tenant sees only its own
// slug-named ClickHouse database; a cross-database reference is denied.

test('warehouseDatabaseForSlug: slug → db, blank/absent → ALL_DATABASES', () => {
  assert.equal(warehouseDatabaseForSlug('bharatunion'), 'bharatunion');
  assert.equal(warehouseDatabaseForSlug('  Suraksha  '), 'suraksha'); // trimmed + lowercased
  assert.equal(warehouseDatabaseForSlug(''), ALL_DATABASES);
  assert.equal(warehouseDatabaseForSlug('   '), ALL_DATABASES);
  assert.equal(warehouseDatabaseForSlug(null), ALL_DATABASES);
  assert.equal(warehouseDatabaseForSlug(undefined), ALL_DATABASES);
});

const TABLES = [
  { name: 'bharatunion.accounts', database: 'bharatunion' },
  { name: 'bharatunion.txns', database: 'bharatunion' },
  { name: 'suraksha.policies', database: 'suraksha' },
  { name: 'todo_demo', database: 'default' },
  { name: 'orphan' }, // no database attribution
];

test('scopeTablesToDatabase: a tenant sees ONLY its own database', () => {
  const bharat = scopeTablesToDatabase(TABLES, 'bharatunion');
  assert.deepEqual(bharat.map((t) => t.name), ['bharatunion.accounts', 'bharatunion.txns']);

  const suraksha = scopeTablesToDatabase(TABLES, 'suraksha');
  assert.deepEqual(suraksha.map((t) => t.name), ['suraksha.policies']);
});

test('scopeTablesToDatabase: a scope drops the OTHER tenant + global junk + unattributed tables', () => {
  const bharat = scopeTablesToDatabase(TABLES, 'bharatunion');
  assert.ok(!bharat.some((t) => t.database === 'suraksha'), 'no cross-tenant');
  assert.ok(!bharat.some((t) => t.name === 'todo_demo'), 'no default/global junk');
  assert.ok(!bharat.some((t) => t.name === 'orphan'), 'unattributed dropped (fail-closed)');
});

test('scopeTablesToDatabase: ALL_DATABASES (single-tenant) passes everything through (a copy)', () => {
  const all = scopeTablesToDatabase(TABLES, ALL_DATABASES);
  assert.equal(all.length, TABLES.length);
  assert.notEqual(all, TABLES, 'returns a new array, not the input reference');
});

test('tableInScope: a bare name is allowed (resolved within the scoped db by the adapter)', () => {
  assert.equal(tableInScope('accounts', 'bharatunion'), true);
});

test('tableInScope: a qualified name is allowed ONLY for the matching database', () => {
  assert.equal(tableInScope('bharatunion.accounts', 'bharatunion'), true);
  assert.equal(tableInScope('BHARATUNION.accounts', 'bharatunion'), true); // case-insensitive db prefix
  // The exact cross-tenant read the fix denies:
  assert.equal(tableInScope('suraksha.policies', 'bharatunion'), false);
  assert.equal(tableInScope('default.system_junk', 'bharatunion'), false);
});

test('tableInScope: ALL_DATABASES allows any reference (single-tenant deploy)', () => {
  assert.equal(tableInScope('anydb.anytable', ALL_DATABASES), true);
  assert.equal(tableInScope('bare', ALL_DATABASES), true);
});
