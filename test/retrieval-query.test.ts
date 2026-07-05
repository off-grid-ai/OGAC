import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildLanceWhere,
  buildQdrantFilter,
  normalizeFilter,
  normalizeMode,
  rrfFuse,
  rrfScore,
  RRF_K,
  type MetaFilter,
} from '../src/lib/retrieval/query.ts';

// Unit tests for the PURE retrieval query logic — no mocks, no I/O. This is the shared "brains"
// both vector backends call: filter→DSL translation and RRF fusion. Backward compatibility (no
// filter → undefined, so callers emit byte-identical requests) is the property under test.

// ── normalizeMode ────────────────────────────────────────────────────────────

test('normalizeMode: default is vector; only "hybrid" opts in', () => {
  assert.equal(normalizeMode(undefined), 'vector');
  assert.equal(normalizeMode(null), 'vector');
  assert.equal(normalizeMode(''), 'vector');
  assert.equal(normalizeMode('nonsense'), 'vector');
  assert.equal(normalizeMode('hybrid'), 'hybrid');
});

// ── normalizeFilter ──────────────────────────────────────────────────────────

test('normalizeFilter: null/empty → null (no filtering)', () => {
  assert.equal(normalizeFilter(null), null);
  assert.equal(normalizeFilter(undefined), null);
  assert.equal(normalizeFilter({}), null);
  assert.equal(normalizeFilter({ must: [] }), null);
  assert.equal(normalizeFilter({ must: 'x' }), null);
});

test('normalizeFilter: valid conditions kept, invalid dropped', () => {
  const f = normalizeFilter({
    must: [
      { field: 'source', match: 'SOP · Claims' },
      { field: 'rows', match: 42 },
      { field: 'tag', any: ['a', 'b'] },
      { field: 'text', text: 'kyc' },
      { field: '', match: 'x' }, // invalid: empty field
      { field: 'bad' }, // invalid: no predicate
      { field: 'bad2', any: [] }, // invalid: empty set
      { nope: true }, // invalid shape
    ],
  });
  assert.deepEqual(f, {
    must: [
      { field: 'source', match: 'SOP · Claims' },
      { field: 'rows', match: 42 },
      { field: 'tag', any: ['a', 'b'] },
      { field: 'text', text: 'kyc' },
    ],
  });
});

test('normalizeFilter: accepts a bare array of conditions', () => {
  const f = normalizeFilter([{ field: 'source', match: 'x' }]);
  assert.deepEqual(f, { must: [{ field: 'source', match: 'x' }] });
});

test('normalizeFilter: all-invalid → null', () => {
  assert.equal(normalizeFilter({ must: [{ field: 'x' }] }), null);
});

// ── buildQdrantFilter ──────────────────────────────────────────────────────────

test('buildQdrantFilter: absent/empty → undefined (byte-identical request today)', () => {
  assert.equal(buildQdrantFilter(undefined), undefined);
  assert.equal(buildQdrantFilter(null), undefined);
  assert.equal(buildQdrantFilter({ must: [] }), undefined);
});

test('buildQdrantFilter: maps each condition kind onto Qdrant DSL', () => {
  const filter: MetaFilter = {
    must: [
      { field: 'source', match: 'SOP · Claims' },
      { field: 'rows', match: 42 },
      { field: 'tag', any: ['a', 'b'] },
      { field: 'text', text: 'kyc' },
    ],
  };
  assert.deepEqual(buildQdrantFilter(filter), {
    must: [
      { key: 'source', match: { value: 'SOP · Claims' } },
      { key: 'rows', match: { value: 42 } },
      { key: 'tag', match: { any: ['a', 'b'] } },
      { key: 'text', match: { text: 'kyc' } },
    ],
  });
});

// ── buildLanceWhere ──────────────────────────────────────────────────────────

test('buildLanceWhere: absent/empty → undefined (no .where, unchanged behaviour)', () => {
  assert.equal(buildLanceWhere(undefined), undefined);
  assert.equal(buildLanceWhere({ must: [] }), undefined);
});

test('buildLanceWhere: match/any/text → SQL predicate, AND-joined', () => {
  const where = buildLanceWhere({
    must: [
      { field: 'source', match: "SOP's Claims" },
      { field: 'rows', match: 42 },
      { field: 'tag', any: ['a', 'b'] },
      { field: 'text', text: 'kyc' },
    ],
  });
  assert.equal(
    where,
    "source = 'SOP''s Claims' AND rows = 42 AND tag IN ('a', 'b') AND " +
      "LOWER(text) LIKE LOWER('%kyc%') ESCAPE '\\'",
  );
});

test('buildLanceWhere: rejects unsafe column names (injection defense)', () => {
  // A crafted field that is not a plain identifier is dropped, not interpolated.
  assert.equal(buildLanceWhere({ must: [{ field: "x'; DROP TABLE", match: 'y' }] }), undefined);
});

test('buildLanceWhere: escapes LIKE wildcards in text needle', () => {
  const where = buildLanceWhere({ must: [{ field: 'text', text: '50%_off' }] });
  assert.equal(where, "LOWER(text) LIKE LOWER('%50\\%\\_off%') ESCAPE '\\'");
});

// ── rrfFuse / rrfScore ──────────────────────────────────────────────────────────

test('rrfFuse: single list preserves order', () => {
  assert.deepEqual(rrfFuse([['a', 'b', 'c']]), ['a', 'b', 'c']);
});

test('rrfFuse: an id ranked well in BOTH lists wins over a single-list top', () => {
  // vector: [x, a, b]   keyword: [y, a, c]
  // 'a' is rank 1 in both → 2·(1/61); 'x' and 'y' each only 1/60. 'a' should top.
  const fused = rrfFuse([
    ['x', 'a', 'b'],
    ['y', 'a', 'c'],
  ]);
  assert.equal(fused[0], 'a');
  assert.deepEqual([...fused].sort(), ['a', 'b', 'c', 'x', 'y']);
});

test('rrfFuse: empty lists → empty', () => {
  assert.deepEqual(rrfFuse([]), []);
  assert.deepEqual(rrfFuse([[], []]), []);
});

test('rrfScore: matches the Σ 1/(k+rank) definition', () => {
  const lists = [
    ['x', 'a'],
    ['a', 'y'],
  ];
  // 'a' is rank 1 in list0 and rank 0 in list1.
  assert.equal(rrfScore(lists, 'a'), 1 / (RRF_K + 1) + 1 / (RRF_K + 0));
  assert.equal(rrfScore(lists, 'missing'), 0);
});
