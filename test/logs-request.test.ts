import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FILTER_FIELDS, parseLogsRequest } from '../src/lib/logs-request.ts';

// Pure request-shaping: URLSearchParams → composed LogsQL + range. No network.

test('parseLogsRequest: empty params → match-all, default range', () => {
  const r = parseLogsRequest(new URLSearchParams());
  assert.equal(r.query, '*');
  assert.equal(r.range.key, '1h');
  assert.equal(r.text, '');
  assert.deepEqual(r.filters, []);
});

test('parseLogsRequest: free text only', () => {
  const r = parseLogsRequest(new URLSearchParams({ q: 'timeout' }));
  assert.equal(r.query, 'timeout');
  assert.equal(r.text, 'timeout');
});

test('parseLogsRequest: field filters compose with free text, filters first', () => {
  const r = parseLogsRequest(
    new URLSearchParams({ q: 'panic', service: 'gateway', level: 'error', range: '24h' }),
  );
  assert.equal(r.query, 'service:"gateway" level:"error" panic');
  assert.equal(r.range.key, '24h');
  assert.deepEqual(r.filters, [
    { field: 'service', value: 'gateway' },
    { field: 'level', value: 'error' },
  ]);
});

test('parseLogsRequest: blank filter values are dropped', () => {
  const r = parseLogsRequest(new URLSearchParams({ service: '  ', level: 'warn' }));
  assert.equal(r.query, 'level:"warn"');
  assert.deepEqual(r.filters, [{ field: 'level', value: 'warn' }]);
});

test('parseLogsRequest: unknown range falls back to default', () => {
  assert.equal(parseLogsRequest(new URLSearchParams({ range: 'nope' })).range.key, '1h');
});

test('FILTER_FIELDS: exposes service and level', () => {
  assert.deepEqual([...FILTER_FIELDS], ['service', 'level']);
});
