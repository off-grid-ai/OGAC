import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isModelKind,
  isAllowedEngine,
  guardModelSelect,
  validateColumnsDdl,
  validateExpr,
  validateModelInput,
  qualifiedName,
  buildApplyDdl,
  buildDropDdl,
  nextVersion,
  planModelApply,
  planModelDrop,
  planRollback,
  serviceErrorStatus,
  serviceErrorMessage,
  MODEL_KINDS,
  ALLOWED_ENGINES,
  type ModelInput,
} from '../src/lib/schema-model.ts';

// ─── guards / predicates ───────────────────────────────────────────────────
test('isModelKind / isAllowedEngine', () => {
  assert.equal(isModelKind('view'), true);
  assert.equal(isModelKind('materialized_view'), true);
  assert.equal(isModelKind('table'), true);
  assert.equal(isModelKind('kafka'), false);
  assert.equal(isModelKind(7), false);
  assert.equal(isAllowedEngine('MergeTree'), true);
  assert.equal(isAllowedEngine('Kafka'), false);
  assert.equal(isAllowedEngine(null), false);
  assert.ok(MODEL_KINDS.length === 3 && ALLOWED_ENGINES.includes('ReplacingMergeTree'));
});

test('guardModelSelect: SELECT/WITH allowed, everything else rejected', () => {
  assert.equal(guardModelSelect('SELECT pan, sum(amount) FROM txns GROUP BY pan').ok, true);
  assert.equal(guardModelSelect('WITH t AS (SELECT 1) SELECT * FROM t').ok, true);
  assert.equal(guardModelSelect('').ok, false);
  assert.equal(guardModelSelect(42).ok, false);
  // read-only guard still applies (DDL / dangerous functions / stacking)
  assert.equal(guardModelSelect('DROP TABLE txns').ok, false);
  assert.equal(guardModelSelect('SELECT * FROM url(\'http://x\')').ok, false);
  assert.equal(guardModelSelect('SELECT 1; SELECT 2').ok, false);
  // SHOW/DESCRIBE are read but NOT valid model bodies
  const show = guardModelSelect('SHOW TABLES');
  assert.equal(show.ok, false);
  assert.match(show.reason ?? '', /must be a SELECT/);
});

test('validateColumnsDdl: safe column lists vs escapes', () => {
  assert.equal(validateColumnsDdl('id UInt64, name String'), true);
  assert.equal(validateColumnsDdl('loan_id UInt64, amount Decimal(18, 2), tags Array(String)'), true);
  assert.equal(validateColumnsDdl(''), false);
  assert.equal(validateColumnsDdl('id UInt64; DROP TABLE x'), false); // semicolon
  assert.equal(validateColumnsDdl("id String DEFAULT 'x'"), false); // quote
  assert.equal(validateColumnsDdl('id UInt64, -- comment'), false); // comment
  assert.equal(validateColumnsDdl('9bad UInt64'), false); // bad identifier
  assert.equal(validateColumnsDdl('id Decimal(18,2'), false); // unbalanced parens
  assert.equal(validateColumnsDdl(42), false);
});

test('validateExpr: order-by / engine args', () => {
  assert.equal(validateExpr('(pan, month)'), true);
  assert.equal(validateExpr('tuple()'), true);
  assert.equal(validateExpr(''), true);
  assert.equal(validateExpr('pan; DROP'), false);
  assert.equal(validateExpr("pan, 'x'"), false);
  assert.equal(validateExpr('a(b'), false); // unbalanced
  assert.equal(validateExpr(7), false);
});

// ─── validateModelInput ─────────────────────────────────────────────────────
test('validateModelInput: valid view', () => {
  const r = validateModelInput({
    name: 'loan_by_branch',
    kind: 'view',
    database: 'bharatunion',
    definition: { selectSql: 'SELECT branch, count() FROM loans GROUP BY branch' },
  });
  assert.deepEqual(r, { ok: true, errors: [] });
});

test('validateModelInput: valid materialized_view + table', () => {
  assert.equal(
    validateModelInput({
      name: 'daily_txn_totals',
      kind: 'materialized_view',
      definition: {
        selectSql: 'SELECT toDate(ts) d, sum(amount) s FROM txns GROUP BY d',
        engine: 'AggregatingMergeTree',
        orderBy: '(d)',
      },
    }).ok,
    true,
  );
  assert.equal(
    validateModelInput({
      name: 'branch_dim',
      kind: 'table',
      definition: { columns: 'ifsc String, branch String', engine: 'MergeTree', orderBy: 'ifsc' },
    }).ok,
    true,
  );
});

test('validateModelInput: collects every error', () => {
  const r = validateModelInput({
    name: '9bad.name',
    kind: 'kafka' as unknown as 'view',
    database: 'bad db',
    definition: {},
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 3);

  const badView = validateModelInput({ name: 'v', kind: 'view', definition: { selectSql: 'DROP x' } });
  assert.equal(badView.ok, false);

  const badMv = validateModelInput({
    name: 'm',
    kind: 'materialized_view',
    definition: { selectSql: 'SELECT 1', engine: 'Kafka', orderBy: 'a; b' },
  });
  assert.equal(badMv.ok, false);
  assert.equal(badMv.errors.length, 2); // bad engine + bad orderBy

  const badTable = validateModelInput({
    name: 't',
    kind: 'table',
    definition: { columns: 'bad;', engine: 'MergeTree' },
  });
  assert.equal(badTable.ok, false);
});

// ─── DDL builders ─────────────────────────────────────────────────────────
test('qualifiedName quotes and qualifies', () => {
  assert.equal(qualifiedName('v'), '`v`');
  assert.equal(qualifiedName('v', 'db'), '`db`.`v`');
});

test('buildApplyDdl: view uses CREATE OR REPLACE', () => {
  const input: ModelInput = {
    name: 'loan_by_branch',
    kind: 'view',
    database: 'bharatunion',
    definition: { selectSql: '  SELECT branch, count() FROM loans GROUP BY branch  ' },
  };
  const ddl = buildApplyDdl(input);
  assert.deepEqual(ddl, [
    'CREATE OR REPLACE VIEW `bharatunion`.`loan_by_branch` AS SELECT branch, count() FROM loans GROUP BY branch',
  ]);
});

test('buildApplyDdl: materialized_view drops then creates', () => {
  const ddl = buildApplyDdl({
    name: 'daily',
    kind: 'materialized_view',
    definition: { selectSql: 'SELECT 1 AS x', engine: 'AggregatingMergeTree', orderBy: '(x)' },
  });
  assert.equal(ddl.length, 2);
  assert.equal(ddl[0], 'DROP VIEW IF EXISTS `daily`');
  assert.match(ddl[1], /^CREATE MATERIALIZED VIEW `daily` ENGINE = AggregatingMergeTree ORDER BY \(x\) AS SELECT 1 AS x$/);
});

test('buildApplyDdl: table with and without orderBy', () => {
  const withOrder = buildApplyDdl({
    name: 'dim',
    kind: 'table',
    definition: { columns: 'ifsc String, branch String', engine: 'MergeTree', orderBy: 'ifsc' },
  });
  assert.equal(withOrder[0], 'DROP TABLE IF EXISTS `dim`');
  assert.equal(withOrder[1], 'CREATE TABLE `dim` (ifsc String, branch String) ENGINE = MergeTree ORDER BY ifsc');

  const noOrder = buildApplyDdl({
    name: 'dim2',
    kind: 'table',
    definition: { columns: 'id UInt64', engine: 'Memory' },
  });
  assert.equal(noOrder[1], 'CREATE TABLE `dim2` (id UInt64) ENGINE = Memory ORDER BY tuple()');
});

test('buildDropDdl by kind', () => {
  assert.equal(buildDropDdl('view', 'v', 'db'), 'DROP VIEW IF EXISTS `db`.`v`');
  assert.equal(buildDropDdl('materialized_view', 'm'), 'DROP VIEW IF EXISTS `m`');
  assert.equal(buildDropDdl('table', 't'), 'DROP TABLE IF EXISTS `t`');
});

test('nextVersion', () => {
  assert.equal(nextVersion(null), 1);
  assert.equal(nextVersion(undefined), 1);
  assert.equal(nextVersion(0), 1);
  assert.equal(nextVersion(1), 2);
  assert.equal(nextVersion(9), 10);
  assert.equal(nextVersion('bad' as unknown as number), 1);
});

// ─── plans (validate-then-build seam) ───────────────────────────────────────
test('planModelApply: valid → statements, invalid → collected errors, no statements', () => {
  const ok = planModelApply({
    name: 'loan_by_branch',
    kind: 'view',
    database: 'bharatunion',
    definition: { selectSql: 'SELECT branch, count() FROM loans GROUP BY branch' },
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.ok && ok.statements, [
    'CREATE OR REPLACE VIEW `bharatunion`.`loan_by_branch` AS SELECT branch, count() FROM loans GROUP BY branch',
  ]);

  const bad = planModelApply({ name: '9bad', kind: 'view', definition: { selectSql: 'DROP x' } });
  assert.equal(bad.ok, false);
  assert.ok(!bad.ok && bad.errors.length >= 1);
  // fail-closed: nothing to run
  assert.equal(bad.ok === false && 'statements' in bad, false);
});

test('planModelDrop: single-statement array by kind', () => {
  assert.deepEqual(planModelDrop('view', 'v', 'db'), ['DROP VIEW IF EXISTS `db`.`v`']);
  assert.deepEqual(planModelDrop('materialized_view', 'm'), ['DROP VIEW IF EXISTS `m`']);
  assert.deepEqual(planModelDrop('table', 't', null), ['DROP TABLE IF EXISTS `t`']);
});

test('planRollback: re-applies the target version frozen DDL', () => {
  const versions = [
    { version: 2, applyDdl: ['CREATE OR REPLACE VIEW `v` AS SELECT 2'] },
    { version: 1, applyDdl: ['CREATE OR REPLACE VIEW `v` AS SELECT 1'] },
  ];
  const r = planRollback(versions, 1);
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.statements, ['CREATE OR REPLACE VIEW `v` AS SELECT 1']);

  // pointing at the current version is allowed (repair / no-op re-apply)
  assert.equal(planRollback(versions, 2).ok, true);
});

test('planRollback: rejects bad target, unknown version, and empty DDL', () => {
  const versions = [
    { version: 1, applyDdl: ['CREATE OR REPLACE VIEW `v` AS SELECT 1'] },
    { version: 3, applyDdl: [] },
  ];
  assert.equal(planRollback(versions, 0).ok, false);
  assert.equal(planRollback(versions, 2.5).ok, false);
  assert.equal(planRollback(versions, -1).ok, false);
  const unknown = planRollback(versions, 9);
  assert.equal(unknown.ok, false);
  assert.match(!unknown.ok ? unknown.reason : '', /not found/);
  const empty = planRollback(versions, 3);
  assert.equal(empty.ok, false);
  assert.match(!empty.ok ? empty.reason : '', /no recorded DDL/);
});

test('serviceErrorStatus / serviceErrorMessage', () => {
  assert.equal(serviceErrorStatus('invalid'), 422);
  assert.equal(serviceErrorStatus('not_found'), 404);
  assert.equal(serviceErrorStatus('warehouse'), 502);
  assert.equal(serviceErrorMessage({ kind: 'invalid', errors: ['a', 'b'] }), 'a; b');
  assert.equal(serviceErrorMessage({ kind: 'not_found', message: 'gone' }), 'gone');
  assert.equal(serviceErrorMessage({ kind: 'warehouse', message: 'ch 500' }), 'ch 500');
});
