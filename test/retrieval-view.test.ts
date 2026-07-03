import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeRetrievalAdapter,
  normalizeRetrieval,
  RETRIEVAL_ADAPTER_IDS,
} from '../src/lib/retrieval-view.ts';

// Unit tests for the PURE retrieval normalizer — no mocks, no I/O. Exercises the real display
// model derivation so malformed Qdrant JSON can never throw or leak into the page.

test('activeRetrievalAdapter: default is the first registry id', () => {
  assert.equal(activeRetrievalAdapter(), RETRIEVAL_ADAPTER_IDS[0]);
  assert.equal(activeRetrievalAdapter(''), RETRIEVAL_ADAPTER_IDS[0]);
  assert.equal(activeRetrievalAdapter('  '), RETRIEVAL_ADAPTER_IDS[0]);
});

test('activeRetrievalAdapter: valid override wins, unknown ignored', () => {
  assert.equal(activeRetrievalAdapter('qdrant'), 'qdrant');
  assert.equal(activeRetrievalAdapter(' pgvector '), 'pgvector');
  assert.equal(activeRetrievalAdapter('nonsense'), RETRIEVAL_ADAPTER_IDS[0]);
});

test('normalizeRetrieval: collections with detail → counts, status, total, sorted', () => {
  const view = normalizeRetrieval({
    adapterId: 'qdrant',
    url: 'http://q:6333',
    reachable: true,
    collectionsBody: { result: { collections: [{ name: 'docs' }, { name: 'aaa' }] } },
    details: {
      docs: { result: { vectors_count: 100, points_count: 90, status: 'green' } },
      aaa: { result: { vectors_count: 5, points_count: 5, status: 'yellow' } },
    },
  });

  assert.equal(view.adapterId, 'qdrant');
  assert.equal(view.isQdrant, true);
  assert.equal(view.url, 'http://q:6333');
  assert.equal(view.reachable, true);
  assert.deepEqual(
    view.collections.map((c) => c.name),
    ['aaa', 'docs'], // sorted
  );
  assert.equal(view.collections[1].vectorsCount, 100);
  assert.equal(view.collections[1].pointsCount, 90);
  assert.equal(view.collections[1].status, 'green');
  assert.equal(view.collections[0].status, 'yellow');
  assert.equal(view.totalVectors, 105);
});

test('normalizeRetrieval: collection without detail defaults to 0 / unknown', () => {
  const view = normalizeRetrieval({
    adapterId: 'qdrant',
    reachable: true,
    collectionsBody: { result: { collections: [{ name: 'docs' }] } },
  });
  assert.equal(view.collections.length, 1);
  assert.equal(view.collections[0].vectorsCount, 0);
  assert.equal(view.collections[0].pointsCount, 0);
  assert.equal(view.collections[0].status, 'unknown');
  assert.equal(view.totalVectors, 0);
});

test('normalizeRetrieval: empty / missing collections body → no collections', () => {
  const empty = normalizeRetrieval({ adapterId: 'qdrant', reachable: true, collectionsBody: { result: { collections: [] } } });
  assert.deepEqual(empty.collections, []);
  assert.equal(empty.totalVectors, 0);

  const none = normalizeRetrieval({ adapterId: 'qdrant', reachable: false });
  assert.deepEqual(none.collections, []);
  assert.equal(none.reachable, false);
  assert.equal(none.url, null);
});

test('normalizeRetrieval: malformed shapes never throw and degrade safely', () => {
  const cases: unknown[] = [
    null,
    'string',
    42,
    { result: 'nope' },
    { result: { collections: 'nope' } },
    { result: { collections: [null, 42, { noName: true }, { name: 123 }] } },
    { result: { collections: [{ name: 'ok' }] } },
  ];
  for (const body of cases) {
    const view = normalizeRetrieval({ adapterId: 'qdrant', reachable: true, collectionsBody: body });
    assert.ok(Array.isArray(view.collections));
    assert.ok(view.totalVectors >= 0);
  }
  // Only the one valid named entry survives from the mixed array.
  const mixed = normalizeRetrieval({
    adapterId: 'qdrant',
    reachable: true,
    collectionsBody: { result: { collections: [null, 42, { noName: true }, { name: 123 }, { name: 'ok' }] } },
  });
  assert.deepEqual(mixed.collections.map((c) => c.name), ['ok']);
});

test('normalizeRetrieval: negative / non-finite / string counts coerced to 0', () => {
  const view = normalizeRetrieval({
    adapterId: 'qdrant',
    reachable: true,
    collectionsBody: { result: { collections: [{ name: 'x' }] } },
    details: { x: { result: { vectors_count: -5, points_count: 'lots', status: 'bogus' } } },
  });
  assert.equal(view.collections[0].vectorsCount, 0);
  assert.equal(view.collections[0].pointsCount, 0);
  assert.equal(view.collections[0].status, 'unknown');
});

test('normalizeRetrieval: non-qdrant adapter → isQdrant false, blank adapter → unknown', () => {
  assert.equal(normalizeRetrieval({ adapterId: 'lancedb', reachable: false }).isQdrant, false);
  assert.equal(normalizeRetrieval({ adapterId: '', reachable: false }).adapterId, 'unknown');
});

test('normalizeRetrieval: accepts detail without the result wrapper (flat body)', () => {
  const view = normalizeRetrieval({
    adapterId: 'qdrant',
    reachable: true,
    collectionsBody: { result: { collections: [{ name: 'flat' }] } },
    details: { flat: { vectors_count: 7, points_count: 7, status: 'green' } },
  });
  assert.equal(view.collections[0].vectorsCount, 7);
  assert.equal(view.collections[0].status, 'green');
});
