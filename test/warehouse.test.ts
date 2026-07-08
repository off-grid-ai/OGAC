import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  buildListTablesSql,
  buildSampleSql,
  buildTableStatsSql,
  clampLimit,
  freshnessOf,
  guardReadOnlySql,
  isSafeIdentifier,
  parseClickHouseJson,
  quoteIdentifier,
  safeIdentifier,
  splitTable,
  toTableSummary,
  withJsonFormat,
} from '../src/lib/warehouse-model.ts';

// ─── Pure: identifier sanitization ───────────────────────────────────────────
test('isSafeIdentifier accepts plain and qualified names, rejects everything unsafe', () => {
  for (const ok of ['events', 'db.events', 'my_table', 'schema_1.tbl_2', 'ABC']) {
    assert.equal(isSafeIdentifier(ok), true, `should accept ${ok}`);
  }
  for (const bad of [
    'events;', 'events;DROP TABLE x', 'events x', 'ev-ents', "ev'ents", 'ev`ents',
    'ev(ents)', 'db.tbl.extra', '.leading', 'trailing.', 'db..tbl', '', 'a b', 'events--',
    'events/*c*/', 'events#c', 'a=1',
  ]) {
    assert.equal(isSafeIdentifier(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

test('safeIdentifier returns the name or null', () => {
  assert.equal(safeIdentifier('db.events'), 'db.events');
  assert.equal(safeIdentifier('bad; drop'), null);
});

test('quoteIdentifier backticks each part; throws on unsafe', () => {
  assert.equal(quoteIdentifier('events'), '`events`');
  assert.equal(quoteIdentifier('db.events'), '`db`.`events`');
  assert.throws(() => quoteIdentifier('bad;'), /unsafe identifier/);
});

test('splitTable splits qualified names, null on unsafe', () => {
  assert.deepEqual(splitTable('events'), { table: 'events' });
  assert.deepEqual(splitTable('db.events'), { database: 'db', table: 'events' });
  assert.equal(splitTable('bad; drop'), null);
});

// ─── Pure: limit clamping ─────────────────────────────────────────────────────
test('clampLimit floors, clamps to [1, MAX], defaults on garbage', () => {
  assert.equal(clampLimit(50), 50);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(-5), 1);
  assert.equal(clampLimit(99999), 1000);
  assert.equal(clampLimit(12.9), 12);
  assert.equal(clampLimit(undefined), 50);
  assert.equal(clampLimit(NaN), 50);
});

// ─── Pure: SQL builders ───────────────────────────────────────────────────────
test('buildListTablesSql excludes system schemas and requests JSON', () => {
  const sql = buildListTablesSql();
  assert.match(sql, /FROM system\.tables/);
  assert.match(sql, /database NOT IN \('system'/);
  assert.match(sql, /FORMAT JSON$/);
});

test('buildTableStatsSql embeds the sanitized name as a string literal + JSON format', () => {
  const sql = buildTableStatsSql('og_probe');
  assert.match(sql, /system\.tables/);
  assert.match(sql, /system\.parts/);
  assert.match(sql, /'og_probe'/);
  assert.match(sql, /currentDatabase\(\)/); // no database qualifier → defaults to current db
  assert.match(sql, /FORMAT JSON$/);

  const q = buildTableStatsSql('mydb.events');
  assert.match(q, /'mydb'/);
  assert.match(q, /'events'/);

  assert.throws(() => buildTableStatsSql('bad; drop'), /unsafe identifier/);
});

test('buildSampleSql quotes the table, clamps the limit, requests JSON', () => {
  assert.equal(buildSampleSql('events', 10), 'SELECT * FROM `events` LIMIT 10 FORMAT JSON');
  assert.equal(buildSampleSql('db.events', 99999), 'SELECT * FROM `db`.`events` LIMIT 1000 FORMAT JSON');
  assert.equal(buildSampleSql('events'), 'SELECT * FROM `events` LIMIT 50 FORMAT JSON');
  assert.throws(() => buildSampleSql('bad; drop'), /unsafe identifier/);
});

// ─── Pure: the READ-ONLY guard (the security core) ─────────────────────────────
test('guardReadOnlySql ACCEPTS single read statements', () => {
  for (const ok of [
    'SELECT 1',
    'select * from events',
    'SELECT * FROM events LIMIT 10',
    'SHOW TABLES',
    'DESCRIBE events',
    'DESC events',
    'EXPLAIN SELECT * FROM events',
    'WITH x AS (SELECT 1) SELECT * FROM x',
    'SELECT count(*) FROM events;', // single trailing semicolon tolerated
    'SELECT created_at, updated_at FROM t', // column names containing forbidden substrings are fine
  ]) {
    const r = guardReadOnlySql(ok);
    assert.equal(r.ok, true, `should accept: ${ok} (reason: ${r.reason})`);
  }
});

test('guardReadOnlySql REJECTS writes, DDL, stacked and commented statements', () => {
  const cases: Array<[string, RegExp]> = [
    ['', /empty/],
    ['   ', /empty/],
    ['INSERT INTO events VALUES (1)', /read queries|forbidden/],
    ['UPDATE events SET x=1', /read queries|forbidden/],
    ['DELETE FROM events', /read queries|forbidden/],
    ['DROP TABLE events', /read queries|forbidden/],
    ['ALTER TABLE events ADD COLUMN y Int', /read queries|forbidden/],
    ['CREATE TABLE t (x Int) ENGINE=Memory', /read queries|forbidden/],
    ['TRUNCATE TABLE events', /read queries|forbidden/],
    ['SYSTEM DROP CACHE', /read queries|forbidden/],
    ['SELECT 1; DROP TABLE events', /multiple statements/],
    ['SELECT 1; SELECT 2', /multiple statements/],
    ['SELECT * FROM events -- comment', /comments/],
    ['SELECT * FROM events /* hi */', /comments/],
    ['SELECT * FROM events # c', /comments/],
    ['SELECT * INTO outfile FROM events', /forbidden keyword: INTO/],
    ['WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x', /forbidden keyword: INSERT/],
    ['SET max_threads = 1', /read queries|forbidden/],
    ['USE mydb', /read queries|forbidden/],
  ];
  for (const [sql, re] of cases) {
    const r = guardReadOnlySql(sql);
    assert.equal(r.ok, false, `should reject: ${sql}`);
    assert.match(r.reason ?? '', re, `wrong reason for: ${sql} → ${r.reason}`);
  }
});

test('withJsonFormat appends FORMAT JSON only when absent', () => {
  assert.equal(withJsonFormat('SELECT 1'), 'SELECT 1 FORMAT JSON');
  assert.equal(withJsonFormat('SELECT 1;'), 'SELECT 1 FORMAT JSON');
  assert.equal(withJsonFormat('SELECT 1 FORMAT TSV'), 'SELECT 1 FORMAT TSV');
  assert.equal(withJsonFormat('SELECT 1 FORMAT JSON'), 'SELECT 1 FORMAT JSON');
});

// ─── Pure: ClickHouse JSON parsing ─────────────────────────────────────────────
test('parseClickHouseJson parses meta/data/rows; degrades to empty on garbage', () => {
  const text = JSON.stringify({
    meta: [{ name: 'x', type: 'UInt8' }],
    data: [{ x: 1 }, { x: 2 }],
    rows: 2,
  });
  const p = parseClickHouseJson(text);
  assert.deepEqual(p.columns, [{ name: 'x', type: 'UInt8' }]);
  assert.equal(p.rows.length, 2);
  assert.equal(p.count, 2);

  for (const junk of ['', '   ', 'not json', '<html>error</html>', 'null', '42']) {
    const e = parseClickHouseJson(junk);
    assert.deepEqual(e, { columns: [], rows: [], count: 0 }, `garbage → empty: ${junk}`);
  }
});

// ─── Pure: freshness ───────────────────────────────────────────────────────────
test('freshnessOf computes age + human label; handles unknown', () => {
  const now = Date.parse('2026-07-08T12:00:00Z');
  assert.equal(freshnessOf(null, now).label, 'unknown');
  assert.equal(freshnessOf('', now).label, 'unknown');
  assert.equal(freshnessOf('0000-00-00 00:00:00', now).label, 'unknown');

  assert.equal(freshnessOf('2026-07-08 11:59:30', now).label, 'just now');
  assert.equal(freshnessOf('2026-07-08 11:30:00', now).label, '30m ago');
  assert.equal(freshnessOf('2026-07-08 09:00:00', now).label, '3h ago');
  assert.equal(freshnessOf('2026-07-06 12:00:00', now).label, '2d ago');

  const f = freshnessOf('2026-07-08 11:00:00', now);
  assert.equal(f.ageMs, 60 * 60 * 1000);
  assert.equal(f.label, '1h ago');
  assert.ok(f.modifiedAt?.startsWith('2026-07-08'));
});

test('toTableSummary folds a list row into the API shape', () => {
  const now = Date.parse('2026-07-08T12:00:00Z');
  const s = toTableSummary(
    { database: 'analytics', name: 'events', rows: '123', bytes: '4096', modified: '2026-07-08 11:00:00' },
    now,
  );
  assert.equal(s.name, 'analytics.events');
  assert.equal(s.rows, 123);
  assert.equal(s.bytes, 4096);
  assert.equal(s.freshness.label, '1h ago');

  // default database is not qualified
  const d = toTableSummary({ database: 'default', name: 'plain', rows: 0, bytes: 0, modified: '' }, now);
  assert.equal(d.name, 'plain');
  assert.equal(d.freshness.label, 'unknown');
});

// ─── REAL integration against the live ClickHouse box ──────────────────────────
// Point the adapter env at the direct-LAN ClickHouse before importing it. Skips (does not fail) if
// the box is unreachable so CI without the LAN passes; runs for real when the LAN is present.
const LAN_URL = 'http://192.168.1.60:8124';
process.env.OFFGRID_WAREHOUSE_URL = LAN_URL;
process.env.OFFGRID_WAREHOUSE_USER = 'warehouse';
process.env.OFFGRID_WAREHOUSE_PASSWORD = 'warehouse';

async function chReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${LAN_URL}/ping`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

// Direct HTTP helper for test setup/teardown (bypasses the adapter so we control the fixture).
async function chExec(query: string): Promise<string> {
  const res = await fetch(`${LAN_URL}/?user=warehouse&password=warehouse`, {
    method: 'POST',
    body: query,
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`clickhouse ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

test('LIVE ClickHouse integration', async (t) => {
  if (!(await chReachable())) {
    t.skip('ClickHouse not reachable at ' + LAN_URL + ' — skipping live integration');
    return;
  }

  // Ensure ≥1 user table exists for listTables to return.
  await chExec('CREATE TABLE IF NOT EXISTS og_probe(x UInt8) ENGINE=Memory');
  await chExec('INSERT INTO og_probe VALUES (1),(2),(3)');

  try {
    // Import the adapter AFTER env is set so warehouseConfig() reads the LAN url.
    const { clickhouseWarehouse } = await import('../src/lib/adapters/warehouse.ts');

    // health() must be true against the live box.
    assert.equal(await clickhouseWarehouse.health(), true, 'health() should be true');

    // Prove we hit 24.8.14.x via a live version query through the read-only path.
    const ver = await clickhouseWarehouse.query('SELECT version() AS v');
    assert.equal(ver.ok, true);
    if (ver.ok) {
      const v = String(ver.result.rows[0]?.v ?? '');
      assert.match(v, /^24\.8\./, `expected ClickHouse 24.8.x, got ${v}`);
      console.log('    live ClickHouse version:', v);
    }

    // listTables returns an array including our probe table.
    const tables = await clickhouseWarehouse.listTables();
    assert.ok(Array.isArray(tables), 'listTables should return an array');
    const probe = tables.find((tb) => tb.name === 'og_probe' || tb.name.endsWith('.og_probe'));
    assert.ok(probe, 'og_probe should appear in listTables');
    console.log('    listTables returned', tables.length, 'tables');

    // tableStats reports the real row count.
    const stats = await clickhouseWarehouse.tableStats('og_probe');
    assert.ok(stats, 'tableStats should not be null');
    assert.equal(stats!.rows, 3, 'og_probe should report 3 rows');

    // sample returns the rows.
    const sample = await clickhouseWarehouse.sample('og_probe', 10);
    assert.ok(sample, 'sample should not be null');
    assert.equal(sample!.count, 3);
    assert.equal(sample!.rows.length, 3);

    // The read-only guard rejects a write before it ever reaches the box.
    const denied = await clickhouseWarehouse.query('DROP TABLE og_probe');
    assert.equal(denied.ok, false);
    assert.match(denied.reason ?? '', /read queries|forbidden/);
  } finally {
    await chExec('DROP TABLE IF EXISTS og_probe').catch(() => undefined);
  }
});
