import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freshnessOf, parseClickHouseJson } from '../src/lib/warehouse-model.ts';

const NOW = Date.parse('2026-07-04T00:00:00Z');

// Cover every input-shape arm + every humanizeAge tier in freshnessOf (lines 245-276), which the
// existing warehouse test only partially reached.

test('freshnessOf accepts a Date instance', () => {
  const f = freshnessOf(new Date(NOW - 5_000), NOW);
  assert.equal(f.label, 'just now');
  assert.ok(f.modifiedAt?.endsWith('Z'));
  assert.equal(f.ageMs, 5_000);
});

test('freshnessOf accepts a raw epoch millis number', () => {
  const f = freshnessOf(NOW - 120_000, NOW);
  assert.equal(f.label, '2m ago');
  assert.ok(f.ageMs! >= 120_000);
});

test('freshnessOf parses a ClickHouse space-separated datetime as UTC', () => {
  // "YYYY-MM-DD HH:MM:SS" → treated as UTC
  const f = freshnessOf('2026-07-03 22:00:00', NOW);
  assert.ok(f.ageMs! > 0);
  assert.match(f.label, /h ago/);
});

test('freshnessOf null/zero/empty → unknown', () => {
  assert.equal(freshnessOf(null, NOW).label, 'unknown');
  assert.equal(freshnessOf('', NOW).label, 'unknown');
  assert.equal(freshnessOf('0000-00-00 00:00:00', NOW).label, 'unknown');
  assert.equal(freshnessOf(undefined, NOW).ageMs, null);
});

test('freshnessOf: an unparseable non-space string → unknown, echoing the raw string', () => {
  const f = freshnessOf('garbage', NOW);
  assert.equal(f.label, 'unknown');
  assert.equal(f.modifiedAt, 'garbage');
});

test('freshnessOf: a future timestamp clamps ageMs to 0', () => {
  const f = freshnessOf(NOW + 60_000, NOW);
  assert.equal(f.ageMs, 0);
  assert.equal(f.label, 'just now');
});

test('humanizeAge covers every tier: minutes, hours, days, months, years', () => {
  const min = 60_000, hour = 60 * min, day = 24 * hour;
  assert.equal(freshnessOf(NOW - 30 * min, NOW).label, '30m ago');
  assert.equal(freshnessOf(NOW - 5 * hour, NOW).label, '5h ago');
  assert.equal(freshnessOf(NOW - 3 * day, NOW).label, '3d ago');
  assert.equal(freshnessOf(NOW - 60 * day, NOW).label, '2mo ago');
  assert.equal(freshnessOf(NOW - 400 * day, NOW).label, '1y ago');
});

test('parseClickHouseJson: rows count falls back to data length when rows field is absent', () => {
  const parsed = parseClickHouseJson(JSON.stringify({ meta: [{ name: 'a', type: 'String' }], data: [{ a: '1' }, { a: '2' }] }));
  assert.equal(parsed.count, 2);
  assert.equal(parsed.columns[0].name, 'a');
});

test('parseClickHouseJson: non-object / non-JSON / empty → empty result', () => {
  assert.equal(parseClickHouseJson('not json{').count, 0);
  assert.equal(parseClickHouseJson('').count, 0);
  assert.equal(parseClickHouseJson('42').count, 0); // valid JSON but not an object
  assert.deepEqual(parseClickHouseJson('null').columns, []);
});
