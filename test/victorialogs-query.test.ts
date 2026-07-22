import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_LIMIT,
  DEFAULT_RANGE_KEY,
  MAX_LIMIT,
  TIME_RANGES,
  buildLogsQuery,
  clampLimit,
  escapeLogsQLValue,
  fieldFilterClause,
  normalizeFieldValues,
  parseRange,
  parseRetentionFlags,
  shapeHits,
} from '../src/lib/victorialogs-query.ts';

// Pure LogsQL/query logic. No network, no mocks — every branch exercised against representative
// VictoriaLogs shapes.

// ─── parseRange ───────────────────────────────────────────────────────────────
test('parseRange: known key resolves to its TimeRange', () => {
  const r = parseRange('24h');
  assert.equal(r.key, '24h');
  assert.equal(r.start, '-24h');
  assert.equal(r.step, '30m');
});

test('parseRange: unknown / blank / nullish → default range', () => {
  for (const raw of ['nope', '', '   ', null, undefined]) {
    assert.equal(parseRange(raw).key, DEFAULT_RANGE_KEY);
  }
});

test('parseRange: trims surrounding whitespace', () => {
  assert.equal(parseRange('  15m  ').key, '15m');
});

test('TIME_RANGES: every entry has a distinct key and relative start', () => {
  const keys = new Set(TIME_RANGES.map((r) => r.key));
  assert.equal(keys.size, TIME_RANGES.length);
  for (const r of TIME_RANGES) assert.match(r.start, /^-\d/);
});

// ─── clampLimit ─────────────────────────────────────────────────────────────
test('clampLimit: numbers clamp into [1, MAX_LIMIT]', () => {
  assert.equal(clampLimit(50), 50);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(-5), 1);
  assert.equal(clampLimit(99999), MAX_LIMIT);
  assert.equal(clampLimit(MAX_LIMIT), MAX_LIMIT);
});

test('clampLimit: string parses; truncates fractional', () => {
  assert.equal(clampLimit('300'), 300);
  assert.equal(clampLimit(12.9), 12);
});

test('clampLimit: non-numeric / missing → DEFAULT_LIMIT', () => {
  for (const raw of ['abc', '', null, undefined, Number.NaN]) {
    assert.equal(clampLimit(raw), DEFAULT_LIMIT);
  }
});

// ─── escapeLogsQLValue / fieldFilterClause ────────────────────────────────────
test('escapeLogsQLValue: escapes backslash then quote', () => {
  assert.equal(escapeLogsQLValue('a"b'), 'a\\"b');
  assert.equal(escapeLogsQLValue('a\\b'), 'a\\\\b');
  assert.equal(escapeLogsQLValue('plain'), 'plain');
});

test('fieldFilterClause: builds a quoted phrase', () => {
  assert.equal(fieldFilterClause({ field: 'level', value: 'error' }), 'level:"error"');
});

test('fieldFilterClause: escapes the value inside the phrase', () => {
  assert.equal(
    fieldFilterClause({ field: 'service', value: 'a"b' }),
    'service:"a\\"b"',
  );
});

test('fieldFilterClause: blank field or value → empty string', () => {
  assert.equal(fieldFilterClause({ field: '', value: 'x' }), '');
  assert.equal(fieldFilterClause({ field: 'level', value: '  ' }), '');
  // @ts-expect-error missing props tolerated at runtime
  assert.equal(fieldFilterClause({}), '');
});

// ─── buildLogsQuery ───────────────────────────────────────────────────────────
test('buildLogsQuery: empty parts → * (match everything)', () => {
  assert.equal(buildLogsQuery({}), '*');
  assert.equal(buildLogsQuery({ text: '   ', filters: [] }), '*');
});

test('buildLogsQuery: free text only', () => {
  assert.equal(buildLogsQuery({ text: 'timeout' }), 'timeout');
});

test('buildLogsQuery: filters only, blank filters dropped', () => {
  assert.equal(
    buildLogsQuery({
      filters: [
        { field: 'service', value: 'console' },
        { field: 'level', value: '' },
      ],
    }),
    'service:"console"',
  );
});

test('buildLogsQuery: filters AND free text, filters first', () => {
  assert.equal(
    buildLogsQuery({
      text: 'panic',
      filters: [
        { field: 'service', value: 'gateway' },
        { field: 'level', value: 'error' },
      ],
    }),
    'service:"gateway" level:"error" panic',
  );
});

// ─── shapeHits ────────────────────────────────────────────────────────────────
test('shapeHits: sums multiple series per timestamp, sorted ascending', () => {
  const series = shapeHits({
    hits: [
      { fields: { level: 'info' }, timestamps: ['2026-07-10T10:01:00Z', '2026-07-10T10:00:00Z'], values: [2, 5] },
      { fields: { level: 'error' }, timestamps: ['2026-07-10T10:00:00Z'], values: [3] },
    ],
  });
  assert.deepEqual(series.buckets, [
    { time: '2026-07-10T10:00:00Z', count: 8 },
    { time: '2026-07-10T10:01:00Z', count: 2 },
  ]);
  assert.equal(series.total, 10);
  assert.equal(series.max, 8);
});

test('shapeHits: non-finite values coerced to 0', () => {
  const series = shapeHits({
    hits: [{ timestamps: ['t1', 't2'], values: ['x', 4] }],
  });
  assert.deepEqual(series.buckets, [
    { time: 't1', count: 0 },
    { time: 't2', count: 4 },
  ]);
  assert.equal(series.total, 4);
  assert.equal(series.max, 4);
});

test('shapeHits: tolerant of junk / empty inputs', () => {
  const empty = { buckets: [], total: 0, max: 0 };
  assert.deepEqual(shapeHits(null), empty);
  assert.deepEqual(shapeHits('nope'), empty);
  assert.deepEqual(shapeHits({}), empty);
  assert.deepEqual(shapeHits({ hits: [] }), empty);
  assert.deepEqual(shapeHits({ hits: [null, 'x', {}] }), empty);
  assert.deepEqual(shapeHits({ hits: [{ timestamps: 'nope', values: [] }] }), empty);
});

// ─── normalizeFieldValues ─────────────────────────────────────────────────────
test('normalizeFieldValues: object form, sorted by hits desc then value asc', () => {
  const out = normalizeFieldValues({
    values: [
      { value: 'info', hits: 10 },
      { value: 'error', hits: 100 },
      { value: 'warn', hits: 100 },
    ],
  });
  assert.deepEqual(out, [
    { value: 'error', hits: 100 },
    { value: 'warn', hits: 100 },
    { value: 'info', hits: 10 },
  ]);
});

test('normalizeFieldValues: bare string array form', () => {
  const out = normalizeFieldValues({ values: ['console', '  gateway  ', ''] });
  assert.deepEqual(out, [
    { value: 'console', hits: 0 },
    { value: 'gateway', hits: 0 },
  ]);
});

test('normalizeFieldValues: drops blank values and non-finite hits → 0', () => {
  const out = normalizeFieldValues({
    values: [{ value: '  ', hits: 5 }, { value: 'x', hits: 'nope' }],
  });
  assert.deepEqual(out, [{ value: 'x', hits: 0 }]);
});

test('normalizeFieldValues: junk inputs → []', () => {
  assert.deepEqual(normalizeFieldValues(null), []);
  assert.deepEqual(normalizeFieldValues('nope'), []);
  assert.deepEqual(normalizeFieldValues({}), []);
  assert.deepEqual(normalizeFieldValues({ values: 'nope' }), []);
  assert.deepEqual(normalizeFieldValues({ values: [42, null] }), []);
});

// ─── parseRetentionFlags ──────────────────────────────────────────────────────
test('parseRetentionFlags: quoted flag value', () => {
  const r = parseRetentionFlags('-retentionPeriod="30d"\n-storageDataPath="/vl"');
  assert.equal(r.retentionPeriod, '30d');
  assert.equal(r.source, 'flags');
});

test('parseRetentionFlags: unquoted flag value with spaces around =', () => {
  const r = parseRetentionFlags('-retentionPeriod = 90d');
  assert.equal(r.retentionPeriod, '90d');
  assert.equal(r.source, 'flags');
});

test('parseRetentionFlags: no override → default, null period', () => {
  for (const raw of ['-storageDataPath="/vl"', '', null, undefined]) {
    const r = parseRetentionFlags(raw);
    assert.equal(r.retentionPeriod, null);
    assert.equal(r.source, 'default');
    assert.match(r.note, /default retention/);
  }
});
