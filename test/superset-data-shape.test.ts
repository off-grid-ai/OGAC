import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type SupersetChartDataResponse,
  type SupersetChartSpec,
  shapeChart,
  toLabel,
  toNumber,
} from '../src/lib/superset-data-shape.ts';

// PURE unit tests for the native BI shaper — the module that replaces the Superset iframe. No
// network, no I/O: it folds a Superset `POST /chart/{id}/data` JSON body into the recharts-ready
// `NativeChartData` the console renders. We assert the SHAPED terminal artifact (rows/series/
// scalar/hasData/error the panel binds to), covering every missing/malformed/error branch both
// ways so the UI degrades to an honest empty rather than fabricating numbers.

// A representative Superset chart-data body with two columns: a time dimension + a numeric series.
function resp(data: Array<Record<string, unknown>> | null | undefined): SupersetChartDataResponse {
  return { result: [{ data: data as Array<Record<string, unknown>> }] };
}

const lineSpec: SupersetChartSpec = {
  id: 'requests-over-time',
  chartId: 1,
  title: 'Requests over time',
  kind: 'line',
};

// ─── toNumber (every branch both ways) ──────────────────────────────────────────
test('toNumber: null/undefined/empty-string → null (honest gap, never 0)', () => {
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(undefined), null);
  assert.equal(toNumber(''), null);
});

test('toNumber: finite number passes, non-finite number → null', () => {
  assert.equal(toNumber(42), 42);
  assert.equal(toNumber(0), 0);
  assert.equal(toNumber(-3.5), -3.5);
  assert.equal(toNumber(Infinity), null);
  assert.equal(toNumber(NaN), null);
});

test('toNumber: numeric string parses, garbage string → null', () => {
  assert.equal(toNumber('123'), 123);
  assert.equal(toNumber('1.5'), 1.5);
  assert.equal(toNumber('not-a-number'), null);
});

test('toNumber: non-number non-string types → null', () => {
  assert.equal(toNumber(true), null);
  assert.equal(toNumber({}), null);
  assert.equal(toNumber([]), null);
});

// ─── toLabel (both branches) ─────────────────────────────────────────────────────
test('toLabel: null/undefined → empty string', () => {
  assert.equal(toLabel(null), '');
  assert.equal(toLabel(undefined), '');
});

test('toLabel: coerces numbers/strings/booleans to a display string', () => {
  assert.equal(toLabel('2026-01-01'), '2026-01-01');
  assert.equal(toLabel(1735689600000), '1735689600000');
  assert.equal(toLabel(0), '0');
  assert.equal(toLabel(false), 'false');
});

// ─── shapeChart: happy path with inference ───────────────────────────────────────
test('shapeChart: infers dim→X and numeric→series from real rows', () => {
  const out = shapeChart(
    lineSpec,
    resp([
      { day: '2026-01-01', requests: 10 },
      { day: '2026-01-02', requests: 25 },
    ]),
  );
  assert.equal(out.hasData, true);
  assert.equal(out.xKey, 'day');
  assert.deepEqual(out.valueKeys, ['requests']);
  assert.deepEqual(out.rows, [
    { day: '2026-01-01', requests: 10 },
    { day: '2026-01-02', requests: 25 },
  ]);
  assert.equal(out.scalar, null); // not a number tile
  assert.equal(out.error, undefined);
  assert.equal(out.id, 'requests-over-time');
  assert.equal(out.title, 'Requests over time');
  assert.equal(out.kind, 'line');
});

test('shapeChart: numeric strings from Superset aggregates are coerced to numbers', () => {
  const out = shapeChart(lineSpec, resp([{ day: 'Mon', requests: '7' }]));
  assert.deepEqual(out.rows, [{ day: 'Mon', requests: 7 }]);
  assert.equal(out.hasData, true);
});

// ─── shapeChart: empty / missing at every level → honest empty ───────────────────
test('shapeChart: empty rows → hasData:false, no fabricated rows', () => {
  const out = shapeChart(lineSpec, resp([]));
  assert.equal(out.hasData, false);
  assert.deepEqual(out.rows, []);
  assert.equal(out.scalar, null);
});

test('shapeChart: null response → honest empty', () => {
  const out = shapeChart(lineSpec, null);
  assert.equal(out.hasData, false);
  assert.deepEqual(out.rows, []);
  assert.equal(out.xKey, ''); // no dims inferred
  assert.deepEqual(out.valueKeys, []);
});

test('shapeChart: undefined response → honest empty', () => {
  const out = shapeChart(lineSpec, undefined);
  assert.equal(out.hasData, false);
  assert.deepEqual(out.rows, []);
});

test('shapeChart: missing result array → honest empty', () => {
  const out = shapeChart(lineSpec, {});
  assert.equal(out.hasData, false);
  assert.deepEqual(out.rows, []);
});

test('shapeChart: result block present but data null → honest empty', () => {
  const out = shapeChart(lineSpec, { result: [{ data: null }] });
  assert.equal(out.hasData, false);
  assert.deepEqual(out.rows, []);
});

test('shapeChart: data not an array (garbage) → honest empty', () => {
  const out = shapeChart(lineSpec, { result: [{ data: 'oops' as unknown as [] }] });
  assert.equal(out.hasData, false);
  assert.deepEqual(out.rows, []);
});

// ─── shapeChart: malformed rows filtered ─────────────────────────────────────────
test('shapeChart: null/non-object rows are filtered out before inference', () => {
  const out = shapeChart(
    lineSpec,
    resp([null, 5, { day: 'X', requests: 3 }] as unknown as Array<Record<string, unknown>>),
  );
  assert.deepEqual(out.rows, [{ day: 'X', requests: 3 }]);
  assert.equal(out.hasData, true);
});

test('shapeChart: a column with no non-empty cell is treated as a dimension, not a series → empty', () => {
  const out = shapeChart(
    lineSpec,
    resp([
      { day: 'a', requests: null },
      { day: 'b', requests: '' },
    ]),
  );
  // `requests` never has a non-empty cell → inference classifies it as a dimension, so there is no
  // numeric series and the panel shows an honest empty state.
  assert.deepEqual(out.valueKeys, []);
  assert.equal(out.hasData, false);
  assert.deepEqual(out.rows, [{ day: 'a' }, { day: 'b' }]);
});

test('shapeChart: pinned value column that is all-null → rows carry null cells, hasData:false', () => {
  const spec: SupersetChartSpec = { ...lineSpec, xColumn: 'day', valueColumns: ['requests'] };
  const out = shapeChart(
    spec,
    resp([
      { day: 'a', requests: null },
      { day: 'b', requests: '' },
    ]),
  );
  // Pinned series column short-circuits inference; every cell coerces to null → honest empty.
  assert.deepEqual(out.valueKeys, ['requests']);
  assert.equal(out.hasData, false);
  assert.deepEqual(out.rows, [
    { day: 'a', requests: null },
    { day: 'b', requests: null },
  ]);
});

// ─── shapeChart: error body ──────────────────────────────────────────────────────
test('shapeChart: Superset error message is surfaced and does not throw', () => {
  const out = shapeChart(lineSpec, { message: 'chart-data 500' });
  assert.equal(out.error, 'chart-data 500');
  assert.equal(out.hasData, false);
  assert.deepEqual(out.rows, []);
});

// ─── shapeChart: spec-pinned columns override inference ──────────────────────────
test('shapeChart: xColumn/valueColumns from the spec pin the mapping', () => {
  const spec: SupersetChartSpec = {
    ...lineSpec,
    xColumn: 'model',
    valueColumns: ['tokens'],
  };
  const out = shapeChart(
    spec,
    resp([
      { model: 'gpt', tokens: 100, ignored: 999 },
      { model: 'claude', tokens: 200, ignored: 111 },
    ]),
  );
  assert.equal(out.xKey, 'model');
  assert.deepEqual(out.valueKeys, ['tokens']);
  assert.deepEqual(out.rows, [
    { model: 'gpt', tokens: 100 },
    { model: 'claude', tokens: 200 },
  ]);
});

test('shapeChart: a valueColumn equal to xKey is dropped from the series', () => {
  const spec: SupersetChartSpec = {
    ...lineSpec,
    xColumn: 'day',
    valueColumns: ['day', 'requests'],
  };
  const out = shapeChart(spec, resp([{ day: 'Mon', requests: 4 }]));
  assert.deepEqual(out.valueKeys, ['requests']); // 'day' filtered because it is the xKey
});

// ─── shapeChart: number tile (kind:'number') ─────────────────────────────────────
const numberSpec: SupersetChartSpec = {
  id: 'total-requests',
  chartId: 2,
  title: 'Total requests',
  kind: 'number',
};

test('shapeChart: number kind → scalar from first value of first row, rows suppressed', () => {
  const out = shapeChart(numberSpec, resp([{ metric: 4211 }]));
  assert.equal(out.kind, 'number');
  assert.equal(out.scalar, 4211);
  assert.equal(out.hasData, true); // scalar != null
  assert.deepEqual(out.rows, []); // number tiles carry no row set
});

test('shapeChart: number kind with no numeric column → scalar null, hasData:false', () => {
  const out = shapeChart(numberSpec, resp([{ label: 'only-a-dimension' }]));
  assert.equal(out.scalar, null);
  assert.equal(out.hasData, false);
});

test('shapeChart: number kind with empty rows → scalar null, hasData:false', () => {
  const out = shapeChart(numberSpec, resp([]));
  assert.equal(out.scalar, null);
  assert.equal(out.hasData, false);
});

test('shapeChart: number kind with a non-finite scalar cell → scalar null', () => {
  const out = shapeChart(numberSpec, resp([{ metric: 'NaN' }]));
  assert.equal(out.scalar, null);
  assert.equal(out.hasData, false);
});
