import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  availableKindFilters,
  filterAndSortEdgeEvents,
  groupEdgeEvents,
  normalizeEdgeSortDirection,
  normalizeEdgeSortField,
  normalizeKindFilter,
} from '../src/lib/edge-view.ts';

// PURE unit tests for the edge (network gateway) view helpers — no DB, no network. They pin the rule
// that the kind-filter chips are driven by the ACTUAL events present, so a "429" (rate-limit) chip
// never appears when the edge is quiet (which would contradict the "0 blocks / 0 requests" band).
// Real function, no mocks.

test('empty events → only "all" (no waf, no rate-limit chip)', () => {
  const kinds = availableKindFilters([]);
  assert.deepEqual(kinds, ['all']);
  assert.ok(!kinds.includes('rate-limit'), 'must not offer 429 when there are no events');
  assert.ok(!kinds.includes('waf'), 'must not offer WAF when there are no events');
});

test('only waf events → ["all","waf"] (no rate-limit chip)', () => {
  const kinds = availableKindFilters([{ kind: 'waf' }, { kind: 'waf' }]);
  assert.deepEqual(kinds, ['all', 'waf']);
  assert.ok(!kinds.includes('rate-limit'));
});

test('only rate-limit events → ["all","rate-limit"] (no waf chip)', () => {
  const kinds = availableKindFilters([{ kind: 'rate-limit' }]);
  assert.deepEqual(kinds, ['all', 'rate-limit']);
  assert.ok(!kinds.includes('waf'));
});

test('both kinds present → all three chips, in stable order', () => {
  const kinds = availableKindFilters([{ kind: 'rate-limit' }, { kind: 'waf' }]);
  assert.deepEqual(kinds, ['all', 'waf', 'rate-limit']);
});

const events = [
  {
    ts: '2026-07-18T10:00:01.000Z',
    status: 403,
    kind: 'waf' as const,
    ip: '10.0.0.2',
    host: 'console.example',
    method: 'GET',
    uri: '/admin',
  },
  {
    ts: '2026-07-18T10:00:07.000Z',
    status: 403,
    kind: 'waf' as const,
    ip: '10.0.0.2',
    host: 'console.example',
    method: 'GET',
    uri: '/admin',
  },
  {
    ts: '2026-07-18T10:00:12.000Z',
    status: 429,
    kind: 'rate-limit' as const,
    ip: '10.0.0.1',
    host: 'api.example',
    method: 'POST',
    uri: '/v1/chat',
  },
];

test('blocked requests group identical events in ten-second buckets', () => {
  const grouped = groupEdgeEvents(events);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0]?.count, 2);
  assert.equal(grouped[1]?.count, 1);
});

test('blocked request filters and sorts are deterministic', () => {
  const grouped = groupEdgeEvents(events);
  assert.deepEqual(
    filterAndSortEdgeEvents(grouped, {
      kind: 'all',
      query: 'example',
      sort: 'ip',
      direction: 'asc',
    }).map((event) => event.ip),
    ['10.0.0.1', '10.0.0.2'],
  );
  assert.deepEqual(
    filterAndSortEdgeEvents(grouped, {
      kind: 'waf',
      query: 'ADMIN',
      sort: 'count',
      direction: 'desc',
    }).map((event) => event.count),
    [2],
  );
});

test('edge query values normalize to safe defaults', () => {
  assert.equal(normalizeKindFilter('rate-limit'), 'rate-limit');
  assert.equal(normalizeKindFilter('unknown'), 'all');
  assert.equal(normalizeEdgeSortField('host'), 'host');
  assert.equal(normalizeEdgeSortField('unknown'), 'ts');
  assert.equal(normalizeEdgeSortDirection('asc'), 'asc');
  assert.equal(normalizeEdgeSortDirection('unknown'), 'desc');
});
