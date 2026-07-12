import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeRetrievalAdapter,
  buildCreatePayload,
  normalizeCollectionName,
  normalizeDistance,
  normalizeRetrieval,
  normalizeWriteResponse,
  retrievalEndpointLabel,
  retrievalNote,
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

// ── Embedded-store affirmative state (the "0 vectors / unreachable" fix) ─────────────────────────
test('embedded store: lancedb is a normal active state, NOT an error, even with 0 vectors', () => {
  // This is exactly the live case: adapter=lancedb, no Qdrant URL, reader marks reachable=false.
  const view = normalizeRetrieval({ adapterId: 'lancedb', reachable: false });
  assert.equal(view.isQdrant, false);
  assert.equal(view.usingEmbeddedStore, true);
  assert.equal(view.totalVectors, 0);
  // The note must AFFIRM the embedded store and say the external DB is optional — never "error".
  assert.match(view.note, /built-in embedded store/i);
  assert.match(view.note, /optional/i);
  assert.match(view.note, /not an error/i);
  assert.doesNotMatch(view.note, /unreachable/i);
});

test('embedded store: pgvector is also treated as the embedded store', () => {
  const view = normalizeRetrieval({ adapterId: 'pgvector', reachable: false });
  assert.equal(view.usingEmbeddedStore, true);
  assert.match(view.note, /pgvector/);
});

test('qdrant reachable is NOT the embedded store, and its note reflects the live DB', () => {
  const view = normalizeRetrieval({
    adapterId: 'qdrant',
    url: 'http://q:6333',
    reachable: true,
    collectionsBody: { result: { collections: [] } },
  });
  assert.equal(view.usingEmbeddedStore, false);
  assert.match(view.note, /external Qdrant/i);
  assert.doesNotMatch(view.note, /unreachable/i);
});

test('qdrant configured-but-unreachable IS an error state (distinct from embedded)', () => {
  const view = normalizeRetrieval({ adapterId: 'qdrant', url: 'http://q:6333', reachable: false });
  assert.equal(view.usingEmbeddedStore, false);
  assert.match(view.note, /unreachable/i);
});

test('retrievalNote: pure branch coverage', () => {
  assert.match(
    retrievalNote({ adapterId: 'lancedb', isQdrant: false, usingEmbeddedStore: true, reachable: false }),
    /embedded store/i,
  );
  assert.match(
    retrievalNote({ adapterId: 'qdrant', isQdrant: true, usingEmbeddedStore: false, reachable: true }),
    /external Qdrant/i,
  );
  assert.match(
    retrievalNote({ adapterId: 'qdrant', isQdrant: true, usingEmbeddedStore: false, reachable: false }),
    /unreachable/i,
  );
});

// ── Collection-management pure logic ───────────────────────────────────────────

test('normalizeDistance: aliases map to Qdrant enum, unknown → null', () => {
  assert.equal(normalizeDistance('cosine'), 'Cosine');
  assert.equal(normalizeDistance(' COS '), 'Cosine');
  assert.equal(normalizeDistance('Dot'), 'Dot');
  assert.equal(normalizeDistance('euclidean'), 'Euclid');
  assert.equal(normalizeDistance('l2'), 'Euclid');
  assert.equal(normalizeDistance('manhattan'), null);
  assert.equal(normalizeDistance(42), null);
  assert.equal(normalizeDistance(undefined), null);
});

test('normalizeCollectionName: valid names trimmed, invalid → null', () => {
  assert.equal(normalizeCollectionName('  docs '), 'docs');
  assert.equal(normalizeCollectionName('my.col_1-2'), 'my.col_1-2');
  assert.equal(normalizeCollectionName(''), null);
  assert.equal(normalizeCollectionName('  '), null);
  assert.equal(normalizeCollectionName('has space'), null);
  assert.equal(normalizeCollectionName('bad/slash'), null);
  assert.equal(normalizeCollectionName('a'.repeat(256)), null);
  assert.equal(normalizeCollectionName(123), null);
});

test('buildCreatePayload: valid input → Qdrant PUT body', () => {
  const r = buildCreatePayload({ name: ' docs ', vectorSize: 1536, distance: 'cosine' });
  assert.equal(r.error, null);
  assert.equal(r.name, 'docs');
  assert.deepEqual(r.payload, { vectors: { size: 1536, distance: 'Cosine' } });
});

test('buildCreatePayload: numeric string size is coerced', () => {
  const r = buildCreatePayload({ name: 'x', vectorSize: '768', distance: 'dot' });
  assert.deepEqual(r.payload, { vectors: { size: 768, distance: 'Dot' } });
});

test('buildCreatePayload: bad name / size / distance → payload null with message', () => {
  const badName = buildCreatePayload({ name: 'bad name', vectorSize: 10, distance: 'cosine' });
  assert.equal(badName.payload, null);
  assert.match(badName.error!, /name/);

  for (const size of [0, -1, 1.5, 70000, 'abc', NaN, undefined]) {
    const r = buildCreatePayload({ name: 'x', vectorSize: size, distance: 'cosine' });
    assert.equal(r.payload, null, `size=${String(size)} should be rejected`);
    assert.match(r.error!, /vectorSize/);
  }

  const badDist = buildCreatePayload({ name: 'x', vectorSize: 10, distance: 'nope' });
  assert.equal(badDist.payload, null);
  assert.match(badDist.error!, /distance/);
});

test('buildCreatePayload: never throws on wildly malformed input', () => {
  for (const input of [{}, { name: null }, { vectorSize: {} }, { distance: [] }] as never[]) {
    const r = buildCreatePayload(input);
    assert.equal(r.payload, null);
    assert.equal(typeof r.error, 'string');
  }
});

test('normalizeWriteResponse: 2xx with result true/object → ok', () => {
  assert.deepEqual(normalizeWriteResponse(200, { result: true, status: 'ok' }), { ok: true, error: null });
  assert.deepEqual(normalizeWriteResponse(201, { result: { name: 'x' } }), { ok: true, error: null });
});

test('normalizeWriteResponse: non-2xx or result=false → error message', () => {
  assert.equal(normalizeWriteResponse(400, { status: { error: 'already exists' } }).ok, false);
  assert.equal(normalizeWriteResponse(400, { status: { error: 'already exists' } }).error, 'already exists');
  assert.equal(normalizeWriteResponse(500, { error: 'boom' }).error, 'boom');
  assert.equal(normalizeWriteResponse(404, null).error, 'HTTP 404');
  assert.equal(normalizeWriteResponse(200, { result: false }).ok, false);
});

test('normalizeWriteResponse: never throws on malformed body', () => {
  for (const body of [null, 'str', 42, [], { status: 'x' }] as unknown[]) {
    const r = normalizeWriteResponse(200, body);
    assert.equal(typeof r.ok, 'boolean');
  }
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

// ── retrievalEndpointLabel: no raw loopback IP may reach a customer surface ──────────────────────

test('retrievalEndpointLabel: embedded store → friendly label, no raw loopback', () => {
  const label = retrievalEndpointLabel({ isQdrant: false, url: 'http://127.0.0.1:6333' });
  assert.equal(label, 'Embedded vector store (local)');
  // Even when a loopback url is present on the view, the embedded case must not leak it.
  assert.ok(!label.includes('127.0.0.1'), 'must not expose 127.0.0.1');
  assert.ok(!label.includes('6333'), 'must not expose the raw port');
});

test('retrievalEndpointLabel: embedded store with null url → still friendly label', () => {
  assert.equal(
    retrievalEndpointLabel({ isQdrant: false, url: null }),
    'Embedded vector store (local)',
  );
});

test('retrievalEndpointLabel: qdrant with loopback url → mapped mDNS host, no raw IP', () => {
  const label = retrievalEndpointLabel({ isQdrant: true, url: 'http://127.0.0.1:6333' });
  assert.ok(!label.includes('127.0.0.1'), 'loopback IP must be rewritten by toDisplayHost');
  assert.ok(label.includes('offgrid-s1.local'), 'loopback maps to the S1 mDNS host');
});

test('retrievalEndpointLabel: qdrant with external host → passed through unchanged', () => {
  assert.equal(
    retrievalEndpointLabel({ isQdrant: true, url: 'https://vectors.example.com:6333' }),
    'https://vectors.example.com:6333',
  );
});

test('retrievalEndpointLabel: qdrant with null url → em dash', () => {
  assert.equal(retrievalEndpointLabel({ isQdrant: true, url: null }), '—');
});
