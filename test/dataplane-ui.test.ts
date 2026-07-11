import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bareTableName,
  DATA_PLANE_ENGINES,
  defaultExpectationsForColumns,
  deriveDataPlaneHealth,
  deriveResultColumns,
  filterTables,
  formatBytes,
  formatCell,
  formatRows,
  freshnessTone,
  groupTablesByDatabase,
  STARTER_QUERIES,
  starterQueriesFor,
  suiteNameForTable,
  tableHref,
  type WarehouseTable,
} from '../src/lib/dataplane-ui.ts';
import { guardReadOnlySql } from '../src/lib/warehouse-model.ts';

// PURE unit tests for the data-plane UI model — no React, no I/O, no mocks. They pin the decisions
// the Catalog/Query/Pipelines surfaces depend on: formatting, db grouping, the starter-query
// catalog, health-band derivation in product language, and quality-check defaults.

function tbl(name: string, database: string | undefined, rows: number, bytes: number): WarehouseTable {
  return { name, database, rows, bytes, freshness: { label: 'just now', ageMs: 1000 } };
}

// ─── formatBytes ───────────────────────────────────────────────────────────────
test('formatBytes handles zero / negative / non-finite as "0 B"', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(-5), '0 B');
  assert.equal(formatBytes(NaN), '0 B');
  assert.equal(formatBytes(undefined), '0 B');
});

test('formatBytes scales into KB/MB/GB with sensible precision', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatBytes(3 * 1024 * 1024 * 1024), '3.0 GB');
});

// ─── formatRows ───────────────────────────────────────────────────────────────
test('formatRows uses en-US grouping and guards bad input', () => {
  assert.equal(formatRows(600000), '600,000');
  assert.equal(formatRows(-1), '0');
  assert.equal(formatRows(NaN), '0');
});

// ─── grouping ─────────────────────────────────────────────────────────────────
test('groupTablesByDatabase hoists bfsi first and sorts tables by rows desc', () => {
  const tables = [
    tbl('analytics.a', 'analytics', 10, 100),
    tbl('bfsi.dim_customer', 'bfsi', 5, 50),
    tbl('bfsi.fact_transaction', 'bfsi', 500000, 900000),
  ];
  const groups = groupTablesByDatabase(tables);
  assert.equal(groups[0].database, 'bfsi', 'bfsi must be first');
  assert.equal(groups[0].tables[0].name, 'bfsi.fact_transaction', 'biggest table first');
  assert.equal(groups[0].totalRows, 500005);
  assert.equal(groups[1].database, 'analytics');
});

test('groupTablesByDatabase defaults a missing database to "default"', () => {
  const groups = groupTablesByDatabase([tbl('loose', undefined, 1, 1)]);
  assert.equal(groups[0].database, 'default');
});

// ─── bareTableName / tableHref ──────────────────────────────────────────────────
test('bareTableName strips the db qualifier; tableHref encodes the segment', () => {
  assert.equal(bareTableName('bfsi.fact_loan'), 'fact_loan');
  assert.equal(bareTableName('plain'), 'plain');
  assert.equal(tableHref({ name: 'bfsi.fact_loan' }), '/data/warehouse/bfsi.fact_loan');
});

// ─── filterTables ───────────────────────────────────────────────────────────────
test('filterTables matches on table or database name, case-insensitively', () => {
  const tables = [tbl('bfsi.dim_customer', 'bfsi', 1, 1), tbl('ops.audit', 'ops', 1, 1)];
  assert.equal(filterTables(tables, 'CUSTOMER').length, 1);
  assert.equal(filterTables(tables, 'ops').length, 1);
  assert.equal(filterTables(tables, '').length, 2);
});

// ─── freshnessTone ──────────────────────────────────────────────────────────────
test('freshnessTone escalates green→amber→red by age and is muted when unknown', () => {
  const day = 24 * 60 * 60 * 1000;
  assert.match(freshnessTone('just now', 1000), /primary/);
  assert.match(freshnessTone('2d ago', 2 * day), /amber/);
  assert.match(freshnessTone('2mo ago', 60 * day), /destructive/);
  assert.match(freshnessTone('unknown', null), /muted/);
});

// ─── starter queries are all read-only (pass the server guard) ──────────────────
// Bank concepts that must NEVER appear in the insurer tenant's starter examples.
const BANK_ONLY = /\b(transaction|npa|non-performing|loan|branch|account)\b/i;

test('every starter query (both flavours) is a single read-only statement against bfsi', () => {
  for (const flavour of ['bank', 'insurer'] as const) {
    const starters = starterQueriesFor(flavour);
    assert.ok(starters.length >= 3, `${flavour} needs ≥3 starters`);
    for (const s of starters) {
      assert.ok(guardReadOnlySql(s.sql).ok, `starter "${s.id}" must pass the read-only guard`);
      assert.match(s.sql, /bfsi\./, `starter "${s.id}" must target the bfsi schema`);
    }
  }
});

test('the default STARTER_QUERIES export is the bank set (back-compat)', () => {
  assert.deepEqual(STARTER_QUERIES, starterQueriesFor('bank'));
});

test('insurer starters carry NO bank-flavoured concepts (no transactions/NPA-loans/branches)', () => {
  for (const s of starterQueriesFor('insurer')) {
    const haystack = `${s.title} ${s.description} ${s.sql}`;
    assert.doesNotMatch(haystack, BANK_ONLY, `insurer starter "${s.id}" leaks a bank concept`);
  }
  // …and it IS insurance: the set as a whole talks policies/premiums/claims.
  const all = starterQueriesFor('insurer')
    .map((s) => `${s.title} ${s.description} ${s.sql}`)
    .join(' ');
  assert.match(all, /polic|premium|persistency|claim/i);
});

test('bank starters still cover the bank book (transactions/NPA/branches present)', () => {
  const all = starterQueriesFor('bank')
    .map((s) => `${s.title} ${s.description} ${s.sql}`)
    .join(' ');
  assert.match(all, /transaction/i);
  assert.match(all, /npa|non-performing/i);
  assert.match(all, /branch/i);
});

// ─── deriveResultColumns ─────────────────────────────────────────────────────────
test('deriveResultColumns prefers meta, falls back to first-row keys', () => {
  assert.deepEqual(
    deriveResultColumns([{ name: 'a' }, { name: 'b' }], []),
    ['a', 'b'],
  );
  assert.deepEqual(deriveResultColumns(undefined, [{ x: 1, y: 2 }]), ['x', 'y']);
  assert.deepEqual(deriveResultColumns(undefined, []), []);
});

// ─── formatCell ─────────────────────────────────────────────────────────────────
test('formatCell renders null as ∅ and objects as JSON', () => {
  assert.equal(formatCell(null), '∅');
  assert.equal(formatCell(undefined), '∅');
  assert.equal(formatCell(42), '42');
  assert.equal(formatCell({ a: 1 }), '{"a":1}');
});

// ─── data-quality defaults ───────────────────────────────────────────────────────
test('defaultExpectationsForColumns builds a not-null expectation per column', () => {
  const exps = defaultExpectationsForColumns([{ name: 'id' }, { name: 'amount' }]);
  assert.equal(exps.length, 2);
  assert.equal(exps[0].type, 'expect_column_values_to_not_be_null');
  assert.equal(exps[0].column, 'id');
  assert.deepEqual(defaultExpectationsForColumns(undefined), []);
});

test('suiteNameForTable is a stable, sanitized identifier', () => {
  assert.equal(suiteNameForTable('bfsi.fact_loan'), 'catalog.bfsi.fact_loan');
  assert.equal(suiteNameForTable('weird name!'), 'catalog.weird_name_');
});

// ─── health band derivation (PRODUCT language, never engine names) ───────────────
test('deriveDataPlaneHealth maps status to product-language views', () => {
  const views = deriveDataPlaneHealth([
    { id: 'warehouse', status: 'up' },
    { id: 'airbyte', status: 'down' },
    { id: 'data-quality', status: 'optional' },
    // streaming omitted → unknown
  ]);
  const byLabel = new Map(views.map((v) => [v.label, v]));
  assert.equal(byLabel.get('Warehouse')?.state, 'up');
  assert.equal(byLabel.get('Pipelines')?.state, 'down');
  assert.equal(byLabel.get('Data quality')?.state, 'optional');
  assert.equal(byLabel.get('Streaming')?.state, 'unknown');
  // No OSS/engine names leak into the labels or blurbs.
  const text = views.map((v) => `${v.label} ${v.blurb} ${v.stateLabel}`).join(' ').toLowerCase();
  for (const banned of ['clickhouse', 'airbyte', 'great expectations', 'redpanda', 'kafka', 'debezium', 'glue', 'athena']) {
    assert.ok(!text.includes(banned), `product language must not expose "${banned}"`);
  }
});

test('DATA_PLANE_ENGINES covers the four data-plane services in move order', () => {
  assert.deepEqual(
    DATA_PLANE_ENGINES.map((e) => e.serviceId),
    ['airbyte', 'streaming', 'warehouse', 'data-quality'],
  );
});
