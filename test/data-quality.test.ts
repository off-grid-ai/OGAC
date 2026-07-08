import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

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
  type Expectation,
  type Row,
  type RawCheckpointResult,
} from '../src/lib/data-quality-model.ts';

// ─── A faithful in-process re-implementation of the sidecar's evaluator (deploy/sidecars/
// great-expectations/app.py :: _native_validate). Used to stand up a REAL local HTTP sidecar the
// adapter talks to — no network mock of fetch, the actual wire path is exercised. This mirrors the
// Python semantics 1:1 so the adapter tests prove correct pass/fail counts per expectation type. ──
function isMissing(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));
}

function nativeValidate(rows: Row[], expectations: Expectation[]): RawCheckpointResult {
  const failed: RawCheckpointResult['failed'] = [];
  for (const exp of expectations) {
    const col = exp.column;
    let unexpected = 0;
    if (exp.type === 'expect_column_values_to_not_be_null') {
      unexpected = rows.filter((r) => isMissing(r[col!])).length;
    } else if (exp.type === 'expect_column_values_to_be_between') {
      for (const r of rows) {
        const v = r[col!];
        if (isMissing(v)) continue;
        if (typeof v !== 'number' || typeof v === 'boolean') {
          unexpected++;
          continue;
        }
        if (exp.min !== undefined && v < exp.min) unexpected++;
        else if (exp.max !== undefined && v > exp.max) unexpected++;
      }
    } else if (exp.type === 'expect_column_values_to_be_in_set') {
      const allowed = exp.value_set ?? [];
      for (const r of rows) {
        const v = r[col!];
        if (isMissing(v)) continue;
        if (!allowed.includes(v)) unexpected++;
      }
    } else if (exp.type === 'expect_column_values_to_be_unique') {
      const counts = new Map<unknown, number>();
      const present: unknown[] = [];
      for (const r of rows) {
        const v = r[col!];
        if (isMissing(v)) continue;
        present.push(v);
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      unexpected = present.filter((v) => (counts.get(v) ?? 0) > 1).length;
    } else if (exp.type === 'expect_column_to_exist') {
      unexpected = rows.length > 0 && rows.some((r) => col! in r) ? 0 : 1;
    } else {
      failed.push({ type: exp.type, column: col, unexpected_count: -1, note: `unsupported expectation type: ${exp.type}` });
      continue;
    }
    if (unexpected > 0) failed.push({ type: exp.type, column: col, unexpected_count: unexpected });
  }
  return { success: failed.length === 0, evaluated: expectations.length, engine: 'native', failed };
}

// Stand up the faithful sidecar on an ephemeral port; returns its base URL + a close().
async function startFakeSidecar(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'great-expectations', engine: 'native' }));
      return;
    }
    if (req.method === 'POST' && req.url?.startsWith('/checkpoint/')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const { rows, expectations } = JSON.parse(body || '{}');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(nativeValidate(rows ?? [], expectations ?? [])));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

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

// ─── UNIT: parseCheckpointResult echoes the engine label from the sidecar ────────────────────────
test('parseCheckpointResult surfaces the engine the sidecar actually used', () => {
  assert.equal(parseCheckpointResult({ success: true, evaluated: 1, engine: 'great-expectations', failed: [] }).engine, 'great-expectations');
  assert.equal(parseCheckpointResult({ success: true, evaluated: 1, engine: 'native', failed: [] }).engine, 'native');
  // Absent → undefined (never invented).
  assert.equal(parseCheckpointResult({ success: true, evaluated: 1, failed: [] }).engine, undefined);
});

// ─── INTEGRATION: adapter → REAL local sidecar (faithful native evaluator over HTTP) ─────────────
// Exercises the true wire path (fetch, JSON, parse) — not a fetch mock — proving correct pass/fail
// counts per expectation type on representative rows + edge cases. One test per expectation type.
test('adapter drives a real sidecar: correct verdict per expectation type', async () => {
  const sidecar = await startFakeSidecar();
  process.env.OFFGRID_DATAQUALITY_URL = sidecar.url;
  // Fresh import so the adapter reads the env we just set.
  const { geDataQuality } = await import('../src/lib/adapters/data-quality.ts');

  try {
    // health reflects the real running engine label.
    const health = await geDataQuality.health();
    assert.equal(health.healthy, true);
    assert.equal(health.engine, 'native');

    // Indian-BFSI-shaped rows: PAN (nullable), amount (INR), status set, id (unique key).
    const rows: Row[] = [
      { pan: 'ABCDE1234F', amount: 50000, status: 'ACTIVE', id: 1 },
      { pan: '', amount: -100, status: 'CLOSED', id: 2 },
      { pan: 'ZZZZZ9999Z', amount: 2_000_000, status: 'PENDING', id: 2 },
    ];

    // not-null: one blank PAN → 1 unexpected.
    let v = await geDataQuality.runCheckpoint('s', rows, [expectNotNull('pan')]);
    assert.equal(v.engineReachable, true);
    assert.equal(v.engine, 'native');
    assert.equal(v.total, 1);
    assert.equal(v.failed, 1);
    assert.equal(v.results.find((r) => !r.success)!.unexpectedCount, 1);

    // between 0..1_000_000: -100 (below) + 2_000_000 (above) → 2 unexpected; nulls ignored.
    v = await geDataQuality.runCheckpoint('s', rows, [expectInRange('amount', 0, 1_000_000)]);
    assert.equal(v.failed, 1);
    assert.equal(v.results.find((r) => !r.success)!.unexpectedCount, 2);

    // in-set {ACTIVE,CLOSED}: PENDING → 1 unexpected.
    v = await geDataQuality.runCheckpoint('s', rows, [expectInSet('status', ['ACTIVE', 'CLOSED'])]);
    assert.equal(v.failed, 1);
    assert.equal(v.results.find((r) => !r.success)!.unexpectedCount, 1);

    // unique on id: value 2 appears twice → 2 unexpected.
    v = await geDataQuality.runCheckpoint('s', rows, [expectUnique('id')]);
    assert.equal(v.failed, 1);
    assert.equal(v.results.find((r) => !r.success)!.unexpectedCount, 2);

    // column-exists: present column passes, absent column fails.
    v = await geDataQuality.runCheckpoint('s', rows, [expectColumnExists('pan'), expectColumnExists('gstin')]);
    assert.equal(v.total, 2);
    assert.equal(v.passed, 1);
    assert.equal(v.failed, 1);
    assert.equal(v.results.find((r) => !r.success)!.column, 'gstin');

    // all-pass suite over the rows → success.
    v = await geDataQuality.runCheckpoint('s', rows, [
      expectInSet('status', ['ACTIVE', 'CLOSED', 'PENDING']),
      expectColumnExists('id'),
    ]);
    assert.equal(v.success, true);
    assert.equal(v.passed, 2);
    assert.equal(v.failed, 0);

    // unsupported type → reported as fail with -1, never silently green.
    v = await geDataQuality.runCheckpoint('s', rows, [{ type: 'expect_something_new', column: 'x' }]);
    assert.equal(v.success, false);
    assert.equal(v.failed, 1);
    assert.equal(v.results[0].unexpectedCount, -1);
    assert.match(v.results[0].detail, /unsupported/);

    // EDGE — empty rows: not-null over zero rows has zero unexpected → passes.
    v = await geDataQuality.runCheckpoint('s', [], [expectNotNull('pan')]);
    assert.equal(v.success, true);
    assert.equal(v.passed, 1);

    // EDGE — empty value_set: nothing allowed → every present value unexpected (3 statuses).
    v = await geDataQuality.runCheckpoint('s', rows, [expectInSet('status', [])]);
    assert.equal(v.failed, 1);
    assert.equal(v.results.find((r) => !r.success)!.unexpectedCount, 3);
  } finally {
    await sidecar.close();
  }
});

// ─── INTEGRATION: adapter fails closed when the sidecar is unreachable (real fetch, no mock) ──────
test('adapter returns a fail-closed verdict when the sidecar is down', async () => {
  const sidecar = await startFakeSidecar();
  const deadUrl = sidecar.url;
  await sidecar.close(); // now nothing is listening on that port
  process.env.OFFGRID_DATAQUALITY_URL = deadUrl;
  const { geDataQuality } = await import('../src/lib/adapters/data-quality.ts');

  const health = await geDataQuality.health();
  assert.equal(health.healthy, false);

  const v = await geDataQuality.runCheckpoint('s', [{ a: 1 }], [expectNotNull('a')]);
  assert.equal(v.engineReachable, false);
  assert.equal(v.success, false);
  assert.equal(v.failed, 1);
  assert.match(v.note ?? '', /unreachable/);
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
