import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCountSql,
  buildCreateDatabaseSql,
  buildCreateTableSql,
  buildInsertSql,
  buildTruncateSql,
  clampRowLimit,
  compileToAirbyteConfig,
  destColumn,
  destColumns,
  isSafeIdent,
  isValidCron,
  normalizeRunStatus,
  projectRow,
  redactionPolicyFromMappings,
  validateJobDraft,
  type ColumnMapping,
  type EtlJobDraft,
  type EtlJobSpec,
} from '../src/lib/etl-job.ts';
import { applyColumnRules } from '../src/lib/data-redaction.ts';

// PURE unit tests for the ETL job model — no DB, no network. Pins spec validation, transform/mapping,
// compile-to-Airbyte-config, the ClickHouse landing SQL builders, and run-status normalization. Real
// functions, no mocks. Proves the movement-path redaction policy derived from mappings drives the
// real data-redaction engine.

// ── validation ──────────────────────────────────────────────────────────────
const validDraft: EtlJobDraft = {
  name: 'Loans',
  sourceConnectorId: 'conn_1',
  sourceResource: 'loans',
  destDatabase: 'warehouse',
  destTable: 'loans',
  mappings: [],
  trigger: 'manual',
};

test('validateJobDraft accepts a complete manual draft', () => {
  const r = validateJobDraft(validDraft);
  assert.equal(r.ok, true, r.errors.join(' '));
});

test('validateJobDraft collects ALL errors, not fail-fast', () => {
  const r = validateJobDraft({ mappings: [], trigger: 'manual' } as Partial<EtlJobDraft>);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 4, `expected multiple errors, got ${r.errors.length}`);
});

test('validateJobDraft rejects an unsafe destination identifier', () => {
  const r = validateJobDraft({ ...validDraft, destTable: 'loans; DROP TABLE x' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.toLowerCase().includes('destination table')));
});

test('validateJobDraft requires a valid cron for a scheduled job', () => {
  const bad = validateJobDraft({ ...validDraft, trigger: 'schedule', cron: 'not a cron' });
  assert.equal(bad.ok, false);
  const good = validateJobDraft({ ...validDraft, trigger: 'schedule', cron: '0 */4 * * *' });
  assert.equal(good.ok, true, good.errors.join(' '));
});

test('validateJobDraft rejects an unsafe destination column in a mapping', () => {
  const r = validateJobDraft({
    ...validDraft,
    mappings: [{ source: 'pan', dest: 'bad col' }],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('destination column')));
});

// ── identifiers + cron ────────────────────────────────────────────────────────
test('isSafeIdent allows identifiers, rejects injection', () => {
  assert.equal(isSafeIdent('loans'), true);
  assert.equal(isSafeIdent('customer_pan'), true);
  assert.equal(isSafeIdent('1abc'), false);
  assert.equal(isSafeIdent('a.b'), false);
  assert.equal(isSafeIdent('x; DROP'), false);
  assert.equal(isSafeIdent(''), false);
});

test('isValidCron validates 5-field expressions', () => {
  assert.equal(isValidCron('0 * * * *'), true);
  assert.equal(isValidCron('*/15 0-6 1,15 * 1-5'), true);
  assert.equal(isValidCron('* * *'), false);
  assert.equal(isValidCron('bad'), false);
  assert.equal(isValidCron('60 * * * *'), true); // range/number allowed; not semantic-checked
});

test('clampRowLimit clamps to [1, MAX] and defaults on garbage', () => {
  assert.equal(clampRowLimit(500), 500);
  assert.equal(clampRowLimit(-3), 1);
  assert.equal(clampRowLimit(1e9), 100_000);
  assert.equal(clampRowLimit(undefined), 1000);
  assert.equal(clampRowLimit(NaN), 1000);
});

// ── transform / mapping ─────────────────────────────────────────────────────
test('destColumn falls back to source when dest is blank', () => {
  assert.equal(destColumn({ source: 'pan' }), 'pan');
  assert.equal(destColumn({ source: 'pan', dest: 'tax_id' }), 'tax_id');
  assert.equal(destColumn({ source: 'pan', dest: '   ' }), 'pan');
});

test('redactionPolicyFromMappings drops keep, keys by SOURCE column', () => {
  const mappings: ColumnMapping[] = [
    { source: 'name', action: 'keep' },
    { source: 'pan', dest: 'tax_id', action: 'mask', keepLast: 4 },
    { source: 'notes', action: 'detect' },
  ];
  const policy = redactionPolicyFromMappings(mappings);
  assert.equal(policy.length, 2);
  assert.deepEqual(policy[0], { column: 'pan', action: 'mask', keepLast: 4 });
  assert.deepEqual(policy[1], { column: 'notes', action: 'detect' });
});

test('redaction policy + applyColumnRules actually redacts a real row', () => {
  const mappings: ColumnMapping[] = [{ source: 'pan', action: 'mask', keepLast: 4 }];
  const policy = redactionPolicyFromMappings(mappings);
  const { rows, totalRedacted } = applyColumnRules([{ pan: 'ABCDE1234F', name: 'Asha' }], policy);
  assert.equal(totalRedacted, 1);
  assert.match(String(rows[0].pan), /234F$/);
  assert.ok(String(rows[0].pan).includes('•'));
  assert.equal(rows[0].name, 'Asha'); // untouched
});

test('projectRow renames to dest columns; empty mappings pass through', () => {
  const row = { pan: '••••1234', name: 'Asha', extra: 1 };
  const mapped = projectRow(row, [
    { source: 'pan', dest: 'tax_id' },
    { source: 'name' },
  ]);
  assert.deepEqual(mapped, { tax_id: '••••1234', name: 'Asha' });
  // no mappings → whole row
  assert.deepEqual(projectRow(row, []), row);
  // unknown source → null
  assert.deepEqual(projectRow({ a: 1 }, [{ source: 'missing', dest: 'm' }]), { m: null });
});

test('destColumns uses mapping dests, else union of sampled keys', () => {
  assert.deepEqual(destColumns([{ source: 'a', dest: 'x' }, { source: 'b' }], []), ['x', 'b']);
  assert.deepEqual(destColumns([], [{ a: 1 }, { a: 2, b: 3 }]), ['a', 'b']);
});

// ── compile to Airbyte config ──────────────────────────────────────────────────
const spec: EtlJobSpec = {
  id: 'etl_1',
  orgId: 'default',
  name: 'Loans',
  sourceConnectorId: 'conn_1',
  sourceResource: 'loans',
  destDatabase: 'warehouse',
  destTable: 'loans_out',
  mappings: [],
  trigger: 'manual',
};

test('compileToAirbyteConfig builds a manual, inactive, single-stream config', () => {
  const cfg = compileToAirbyteConfig(spec, 'src_A', 'dst_B');
  assert.equal(cfg.sourceId, 'src_A');
  assert.equal(cfg.destinationId, 'dst_B');
  assert.equal(cfg.scheduleType, 'manual');
  assert.equal(cfg.status, 'inactive');
  assert.equal(cfg.scheduleData, undefined);
  assert.equal(cfg.syncCatalog.streams.length, 1);
  assert.equal(cfg.syncCatalog.streams[0].stream.name, 'loans');
  assert.equal(cfg.syncCatalog.streams[0].config.aliasName, 'loans_out');
  assert.equal(cfg.syncCatalog.streams[0].config.destinationSyncMode, 'overwrite');
});

test('compileToAirbyteConfig emits a cron schedule + active status when scheduled', () => {
  const cfg = compileToAirbyteConfig(
    { ...spec, trigger: 'schedule', cron: '0 2 * * *' },
    'src_A',
    'dst_B',
  );
  assert.equal(cfg.scheduleType, 'cron');
  assert.equal(cfg.status, 'active');
  assert.equal(cfg.scheduleData?.cron.cronExpression, '0 2 * * *');
});

// ── ClickHouse landing SQL ──────────────────────────────────────────────────
test('buildCreateDatabaseSql / buildTruncateSql quote identifiers and guard', () => {
  assert.equal(buildCreateDatabaseSql('warehouse'), 'CREATE DATABASE IF NOT EXISTS `warehouse`');
  assert.equal(
    buildTruncateSql('warehouse', 'loans'),
    'TRUNCATE TABLE IF EXISTS `warehouse`.`loans`',
  );
  assert.throws(() => buildCreateDatabaseSql('bad; DROP'));
});

test('buildCreateTableSql makes Nullable(String) cols + an _ingested_at column', () => {
  const sql = buildCreateTableSql('warehouse', 'loans', ['pan', 'amount', 'bad col']);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS `warehouse`\.`loans`/);
  assert.match(sql, /`pan` Nullable\(String\)/);
  assert.match(sql, /`amount` Nullable\(String\)/);
  assert.ok(!sql.includes('bad col'), 'unsafe column dropped');
  assert.match(sql, /`_ingested_at` DateTime DEFAULT now\(\)/);
  assert.match(sql, /ENGINE = MergeTree ORDER BY tuple\(\)/);
});

test('buildInsertSql serializes JSONEachRow, stringifies non-strings, keeps null', () => {
  const sql = buildInsertSql(
    'warehouse',
    'loans',
    ['pan', 'amount'],
    [{ pan: 'X', amount: 42 }, { pan: null, amount: null }],
  );
  assert.ok(sql);
  const lines = sql!.split('\n');
  assert.match(lines[0], /INSERT INTO `warehouse`\.`loans` \(`pan`, `amount`\) FORMAT JSONEachRow/);
  assert.deepEqual(JSON.parse(lines[1]), { pan: 'X', amount: '42' });
  assert.deepEqual(JSON.parse(lines[2]), { pan: null, amount: null });
});

test('buildInsertSql returns null for an empty batch or no columns', () => {
  assert.equal(buildInsertSql('w', 't', ['a'], []), null);
  assert.equal(buildInsertSql('w', 't', [], [{ a: 1 }]), null);
});

test('buildCountSql targets the landed table', () => {
  assert.equal(buildCountSql('warehouse', 'loans'), 'SELECT count() AS n FROM `warehouse`.`loans` FORMAT JSON');
});

// ── run status normalization ───────────────────────────────────────────────────
test('normalizeRunStatus maps engine + airbyte spellings', () => {
  assert.equal(normalizeRunStatus('ok'), 'succeeded');
  assert.equal(normalizeRunStatus('done'), 'succeeded');
  assert.equal(normalizeRunStatus('error'), 'failed');
  assert.equal(normalizeRunStatus('succeeded'), 'succeeded'); // via etl-model
  assert.equal(normalizeRunStatus('running'), 'running');
  assert.equal(normalizeRunStatus('cancelled'), 'cancelled');
  assert.equal(normalizeRunStatus('gobbledygook'), 'pending');
});
