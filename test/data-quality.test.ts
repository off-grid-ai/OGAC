import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCheckpoint,
  expectNotNull,
  expectInRange,
  expectInSet,
  expectUnique,
  expectColumnExists,
  parseCheckpointResult,
  failureVerdict,
  summarize,
  type RawCheckpointResult,
} from '../src/lib/data-quality-model.ts';

// ─── UNIT: expectation constructors ─────────────────────────────────────────────────────────────
test('expectation constructors emit the sidecar vocabulary', () => {
  assert.deepEqual(expectNotNull('pan'), {
    type: 'expect_column_values_to_not_be_null',
    column: 'pan',
  });
  assert.deepEqual(expectInRange('amount', 0, 100), {
    type: 'expect_column_values_to_be_between',
    column: 'amount',
    min: 0,
    max: 100,
  });
  // Only the bound(s) supplied appear.
  assert.deepEqual(expectInRange('amount', 0), {
    type: 'expect_column_values_to_be_between',
    column: 'amount',
    min: 0,
  });
  assert.deepEqual(expectInSet('status', ['A', 'B']), {
    type: 'expect_column_values_to_be_in_set',
    column: 'status',
    value_set: ['A', 'B'],
  });
  assert.deepEqual(expectColumnExists('ifsc'), {
    type: 'expect_column_to_exist',
    column: 'ifsc',
  });
  assert.deepEqual(expectUnique('id'), {
    type: 'expect_column_values_to_be_unique',
    column: 'id',
  });
});

// ─── UNIT: buildCheckpoint coerces loose input into a clean wire body ────────────────────────────
test('buildCheckpoint filters junk rows/expectations and keeps only known fields', () => {
  const cp = buildCheckpoint(
    [{ amount: 100 }, 'nope', null, [1, 2], { amount: -5 }],
    [
      expectInRange('amount', 0),
      { type: 42 }, // bad type → dropped
      { column: 'x' }, // no type → dropped
      { type: 'expect_column_values_to_be_in_set', column: 's', value_set: ['a'], junk: 1 },
    ],
  );
  assert.deepEqual(cp.rows, [{ amount: 100 }, { amount: -5 }]);
  assert.equal(cp.expectations.length, 2);
  assert.deepEqual(cp.expectations[0], { type: 'expect_column_values_to_be_between', column: 'amount', min: 0 });
  // Unknown 'junk' key stripped; value_set preserved.
  assert.deepEqual(cp.expectations[1], {
    type: 'expect_column_values_to_be_in_set',
    column: 's',
    value_set: ['a'],
  });
});

test('buildCheckpoint tolerates non-array inputs', () => {
  assert.deepEqual(buildCheckpoint(undefined, null), { rows: [], expectations: [] });
});

// ─── UNIT: parseCheckpointResult on a representative raw payload ─────────────────────────────────
test('parseCheckpointResult reconstructs exact pass/fail counts from a failures-only response', () => {
  const raw: RawCheckpointResult = {
    success: false,
    evaluated: 3,
    failed: [{ type: 'expect_column_values_to_be_between', column: 'amount', unexpected_count: 1 }],
  };
  const v = parseCheckpointResult(raw);
  assert.equal(v.success, false);
  assert.equal(v.total, 3);
  assert.equal(v.failed, 1);
  assert.equal(v.passed, 2);
  assert.equal(v.engineReachable, true);
  assert.equal(v.results.length, 3);
  const fail = v.results.find((r) => !r.success);
  assert.ok(fail);
  assert.equal(fail!.column, 'amount');
  assert.equal(fail!.unexpectedCount, 1);
  assert.match(fail!.detail, /1 unexpected value/);
  assert.equal(v.results.filter((r) => r.success).length, 2);
});

test('parseCheckpointResult all-pass', () => {
  const v = parseCheckpointResult({ success: true, evaluated: 2, failed: [] });
  assert.equal(v.success, true);
  assert.equal(v.passed, 2);
  assert.equal(v.failed, 0);
  assert.equal(v.results.every((r) => r.success), true);
});

test('parseCheckpointResult counts an unsupported (-1) expectation as a fail, never silently green', () => {
  const v = parseCheckpointResult({
    success: false,
    evaluated: 1,
    failed: [
      {
        type: 'expect_column_values_to_be_unique',
        column: 'id',
        unexpected_count: -1,
        note: 'unsupported in fallback; needs the GE engine',
      },
    ],
  });
  assert.equal(v.success, false);
  assert.equal(v.failed, 1);
  assert.equal(v.passed, 0);
  assert.match(v.results[0].detail, /unsupported/);
});

// ─── UNIT: failureVerdict (unreachable → well-formed failure, not a throw) ───────────────────────
test('failureVerdict yields a fail-closed verdict naming every un-evaluated expectation', () => {
  const exps = [expectInRange('amount', 0), expectNotNull('pan')];
  const v = failureVerdict(exps, 'ECONNREFUSED');
  assert.equal(v.success, false);
  assert.equal(v.engineReachable, false);
  assert.equal(v.total, 2);
  assert.equal(v.failed, 2);
  assert.equal(v.passed, 0);
  assert.equal(v.results.length, 2);
  assert.equal(v.results.every((r) => r.unexpectedCount === -1 && !r.success), true);
  assert.match(v.note ?? '', /unreachable/);
});

// ─── UNIT: summarize rollup ──────────────────────────────────────────────────────────────────────
test('summarize renders a legible one-line rollup', () => {
  assert.match(
    summarize(parseCheckpointResult({ success: true, evaluated: 3, failed: [] })),
    /PASS — 3\/3 expectations passed, 0 failed/,
  );
  assert.match(
    summarize(
      parseCheckpointResult({
        success: false,
        evaluated: 2,
        failed: [{ type: 'x', column: 'c', unexpected_count: 2 }],
      }),
    ),
    /FAIL — 1\/2 expectations passed, 1 failed/,
  );
  assert.match(summarize(failureVerdict([expectNotNull('a')], 'ETIMEDOUT')), /unreachable/);
  assert.equal(
    summarize(parseCheckpointResult({ success: true, evaluated: 0, failed: [] })),
    'no expectations evaluated',
  );
});

// ─── INTEGRATION: real GE sidecar over the LAN ──────────────────────────────────────────────────
// Set the adapter's env to the live sidecar, POST a real checkpoint, assert the verdict. t.skip if
// unreachable so offline CI still passes.
test('geDataQuality.runCheckpoint against the LIVE Great Expectations sidecar', async (t) => {
  const LIVE = 'http://192.168.1.60:8003';
  process.env.OFFGRID_DATAQUALITY_URL = LIVE;

  // Probe first so an offline run skips cleanly rather than failing.
  try {
    const ping = await fetch(`${LIVE}/`, { signal: AbortSignal.timeout(2500) });
    if (!ping.ok) return t.skip('sidecar not ok');
  } catch {
    return t.skip('sidecar unreachable');
  }

  const { geDataQuality } = await import('../src/lib/adapters/data-quality.ts');

  const health = await geDataQuality.health();
  assert.equal(health.healthy, true);
  assert.equal(typeof health.engine, 'string');

  // rows [{amount:100},{amount:-5}] with expectation amount >= 0 → exactly one unexpected value.
  const verdict = await geDataQuality.runCheckpoint(
    'offgrid_integration',
    [{ amount: 100 }, { amount: -5 }],
    [expectInRange('amount', 0)],
  );
  assert.equal(verdict.engineReachable, true, JSON.stringify(verdict));
  assert.equal(verdict.total, 1);
  assert.equal(verdict.success, false);
  assert.equal(verdict.failed, 1);
  assert.equal(verdict.passed, 0);
  const fail = verdict.results.find((r) => !r.success);
  assert.ok(fail, 'expected a failing expectation');
  assert.equal(fail!.column, 'amount');
  assert.equal(fail!.unexpectedCount, 1);

  // And a passing case: same rows, amount between -100 and 100 → all pass.
  const ok = await geDataQuality.runCheckpoint(
    'offgrid_integration',
    [{ amount: 100 }, { amount: -5 }],
    [expectInRange('amount', -100, 100)],
  );
  assert.equal(ok.success, true, JSON.stringify(ok));
  assert.equal(ok.passed, 1);
  assert.equal(ok.failed, 0);
});
