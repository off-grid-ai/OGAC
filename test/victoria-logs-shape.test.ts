import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  emptyLogsResult,
  normalizeLogsQuery,
  parseLogLine,
  parseLogsResponse,
} from '../src/lib/victoria-logs-shape.ts';

// Pure shaping of VictoriaLogs LogsQL JSONL output. No network, no mocks.

test('parseLogLine: lifts system fields, keeps user fields', () => {
  const row = parseLogLine(
    JSON.stringify({
      _time: '2026-07-10T10:00:00Z',
      _msg: 'request handled',
      _stream: '{service="gateway"}',
      level: 'info',
      status: 200,
    }),
  );
  assert.ok(row);
  assert.equal(row!.time, '2026-07-10T10:00:00Z');
  assert.equal(row!.message, 'request handled');
  assert.equal(row!.stream, '{service="gateway"}');
  assert.deepEqual(row!.fields, { level: 'info', status: '200' });
});

test('parseLogLine: blank / invalid / non-object lines → null', () => {
  assert.equal(parseLogLine(''), null);
  assert.equal(parseLogLine('   '), null);
  assert.equal(parseLogLine('not json'), null);
  assert.equal(parseLogLine('[1,2,3]'), null);
  assert.equal(parseLogLine('null'), null);
  assert.equal(parseLogLine('42'), null);
});

test('parseLogLine: missing fields default to empty strings, never throws', () => {
  const row = parseLogLine('{}');
  assert.deepEqual(row, { time: '', message: '', stream: '', fields: {} });
});

test('parseLogsResponse: parses JSONL, drops junk, newest-first', () => {
  const body = [
    JSON.stringify({ _time: '2026-07-10T10:00:00Z', _msg: 'a' }),
    '',
    'garbage',
    JSON.stringify({ _time: '2026-07-10T11:00:00Z', _msg: 'b' }),
  ].join('\n');
  const rows = parseLogsResponse(body);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].message, 'b'); // newest first
  assert.equal(rows[1].message, 'a');
});

test('parseLogsResponse: equal timestamps keep stable order (comparator 0 branch)', () => {
  const body = [
    JSON.stringify({ _time: '2026-07-10T10:00:00Z', _msg: 'first' }),
    JSON.stringify({ _time: '2026-07-10T10:00:00Z', _msg: 'second' }),
  ].join('\n');
  const rows = parseLogsResponse(body);
  assert.deepEqual(
    rows.map((r) => r.message),
    ['first', 'second'],
  );
});

test('parseLogsResponse: empty / nullish → [] (never throws)', () => {
  assert.deepEqual(parseLogsResponse(''), []);
  assert.deepEqual(parseLogsResponse(null), []);
  assert.deepEqual(parseLogsResponse(undefined), []);
});

test('normalizeLogsQuery: empty → "*"; trims; passes real queries', () => {
  assert.equal(normalizeLogsQuery(''), '*');
  assert.equal(normalizeLogsQuery('   '), '*');
  assert.equal(normalizeLogsQuery(null), '*');
  assert.equal(normalizeLogsQuery(undefined), '*');
  assert.equal(normalizeLogsQuery('  error  '), 'error');
  assert.equal(normalizeLogsQuery('_stream:{service="gw"}'), '_stream:{service="gw"}');
});

test('emptyLogsResult: typed empty, configured flag honored', () => {
  assert.deepEqual(emptyLogsResult(), { configured: false, rows: [], query: '' });
  assert.deepEqual(emptyLogsResult('q', true), { configured: true, rows: [], query: 'q' });
});
