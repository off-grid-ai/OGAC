import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type PromQueryResponse,
  parseSampleValue,
  scalarValue,
  seriesLabel,
  shapeChart,
  shapeSeries,
} from '../src/lib/victoria-metrics-shape.ts';

// Pure shaping of VictoriaMetrics (Prometheus HTTP API) responses. No network, no mocks — real
// functions fed representative /api/v1/query{,_range} JSON.

const RANGE: PromQueryResponse = {
  status: 'success',
  data: {
    resultType: 'matrix',
    result: [
      {
        metric: { __name__: 'reqs', service: 'gateway' },
        values: [
          [1000, '5'],
          [1060, '7'],
        ],
      },
      {
        metric: { __name__: 'reqs', service: 'chat' },
        values: [
          [1000, '2'],
          [1060, 'NaN'],
        ],
      },
    ],
  },
};

const INSTANT: PromQueryResponse = {
  status: 'success',
  data: {
    resultType: 'vector',
    result: [{ metric: { __name__: 'up', instance: 'a' }, value: [1060, '1'] }],
  },
};

test('parseSampleValue: finite floats parse; NaN/Inf/garbage → null (honest gap)', () => {
  assert.equal(parseSampleValue('5'), 5);
  assert.equal(parseSampleValue('3.14'), 3.14);
  assert.equal(parseSampleValue('NaN'), null);
  assert.equal(parseSampleValue('+Inf'), null);
  assert.equal(parseSampleValue('-Inf'), null);
  assert.equal(parseSampleValue('nope'), null);
  assert.equal(parseSampleValue(null), null);
  assert.equal(parseSampleValue(undefined), null);
});

test('seriesLabel: prefers common identifying labels, falls back to {k=v}', () => {
  assert.equal(seriesLabel({ service: 'gateway', foo: 'bar' }), 'gateway');
  assert.equal(seriesLabel({ job: 'otel' }), 'otel');
  assert.equal(seriesLabel({ __name__: 'x', k: 'v' }), 'x{k=v}');
  assert.equal(seriesLabel({ k: 'v' }), '{k=v}');
  assert.equal(seriesLabel({ __name__: 'lonely' }), 'lonely');
  assert.equal(seriesLabel({}), 'value');
  assert.equal(seriesLabel(null), 'value');
});

test('shapeSeries: range matrix → per-series points, NaN becomes a null gap', () => {
  const s = shapeSeries(RANGE);
  assert.equal(s.length, 2);
  assert.equal(s[0].label, 'gateway');
  assert.deepEqual(
    s[0].points.map((p) => p.v),
    [5, 7],
  );
  assert.deepEqual(
    s[1].points.map((p) => p.v),
    [2, null],
  );
});

test('shapeSeries: instant vector → single-point series', () => {
  const s = shapeSeries(INSTANT);
  assert.equal(s.length, 1);
  assert.equal(s[0].points.length, 1);
  assert.equal(s[0].points[0].v, 1);
});

test('shapeSeries: empty / malformed → [] (never throws)', () => {
  assert.deepEqual(shapeSeries(null), []);
  assert.deepEqual(shapeSeries({}), []);
  assert.deepEqual(shapeSeries({ data: { result: null } }), []);
  assert.deepEqual(shapeSeries({ data: { result: 'x' as unknown as [] } }), []);
});

test('shapeSeries: points sorted oldest→newest even if out of order', () => {
  const s = shapeSeries({
    data: {
      result: [
        {
          metric: {},
          values: [
            [2000, '2'],
            [1000, '1'],
          ],
        },
      ],
    },
  });
  assert.deepEqual(
    s[0].points.map((p) => p.t),
    [1000, 2000],
  );
});

test('shapeSeries: malformed value/values pairs are skipped, not thrown', () => {
  // a matrix pair with only one element, and an instant value with only one element → both skipped
  const s = shapeSeries({
    data: {
      result: [
        { metric: { service: 'a' }, values: [[1] as unknown as [number, string], [2, '2']] },
        { metric: { service: 'b' }, value: [3] as unknown as [number, string] },
      ],
    },
  });
  assert.deepEqual(
    s[0].points.map((p) => p.t),
    [2],
  );
  assert.deepEqual(s[1].points, []); // short instant value → no point
});

test('scalarValue: latest finite value of first series, else null', () => {
  assert.equal(scalarValue(INSTANT), 1);
  assert.equal(scalarValue(RANGE), 7);
  assert.equal(scalarValue(null), null);
  // all-null series → null (no fabricated 0)
  assert.equal(scalarValue({ data: { result: [{ metric: {}, values: [[1, 'NaN']] }] } }), null);
});

test('shapeChart: multi-series folds to per-timestamp rows keyed by label', () => {
  const c = shapeChart('Request rate', 'req/s', RANGE);
  assert.equal(c.title, 'Request rate');
  assert.equal(c.unit, 'req/s');
  assert.deepEqual(c.keys, ['gateway', 'chat']);
  assert.equal(c.emitting, true);
  assert.equal(c.rows.length, 2);
  assert.deepEqual(c.rows[0], { t: 1000, gateway: 5, chat: 2 });
  assert.deepEqual(c.rows[1], { t: 1060, gateway: 7, chat: null });
});

test('shapeChart: dedupes duplicate series labels so recharts keys stay unique', () => {
  const c = shapeChart('x', '', {
    data: {
      result: [
        { metric: { service: 'dup' }, values: [[1, '1']] },
        { metric: { service: 'dup' }, values: [[1, '2']] },
      ],
    },
  });
  assert.deepEqual(c.keys, ['dup', 'dup #2']);
  assert.deepEqual(c.rows[0], { t: 1, dup: 1, 'dup #2': 2 });
});

test('shapeChart: no data → emitting:false (honest empty state, not zeros)', () => {
  const c = shapeChart('Error rate', 'err/s', { data: { result: [] } });
  assert.equal(c.emitting, false);
  assert.deepEqual(c.rows, []);
});

test('shapeChart: all-null samples → emitting:false (a gap is not live data)', () => {
  const c = shapeChart('x', '', { data: { result: [{ metric: {}, values: [[1, 'NaN']] }] } });
  assert.equal(c.emitting, false);
});

test('shapeChart: surfaces VM query error message', () => {
  const c = shapeChart('x', '', { error: 'unknown function' });
  assert.equal(c.error, 'unknown function');
  assert.equal(c.emitting, false);
});
