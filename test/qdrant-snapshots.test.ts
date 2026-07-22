import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildRecoverRequest,
  formatSize,
  normalizeCollectionInfo,
  normalizeCollectionNames,
  normalizeCreatedSnapshot,
  normalizeSnapshots,
  snapshotDownloadPath,
  toCollectionSummary,
  validateCollectionName,
  validateSnapshotName,
} from '../src/lib/qdrant-snapshots.ts';

// PURE snapshot/collection-admin logic exercised against REAL Qdrant REST envelope shapes. No I/O.
// The load-bearing properties: name validation is the path-traversal gate, and the normalizers turn
// Qdrant's `{ result }` envelopes into typed rows without ever throwing on missing/garbage fields.

// ── validateCollectionName ──────────────────────────────────────────────────────
test('collection name: accepts a normal name', () => {
  assert.deepEqual(validateCollectionName('offgrid-brain'), { ok: true });
  assert.equal(validateCollectionName('col_1.v2').ok, true);
});

test('collection name: rejects empty / non-string', () => {
  assert.equal(validateCollectionName('').ok, false);
  assert.equal(validateCollectionName(undefined).ok, false);
  assert.equal(validateCollectionName(42).ok, false);
});

test('collection name: rejects path traversal + separators', () => {
  assert.equal(validateCollectionName('../etc').ok, false);
  assert.equal(validateCollectionName('a/b').ok, false);
  assert.equal(validateCollectionName('a\\b').ok, false);
});

test('collection name: rejects illegal charset + leading punctuation', () => {
  assert.equal(validateCollectionName('has space').ok, false);
  assert.equal(validateCollectionName('.hidden').ok, false);
  assert.equal(validateCollectionName('name!').ok, false);
});

test('collection name: rejects over 255 chars, accepts 255', () => {
  assert.equal(validateCollectionName('a'.repeat(255)).ok, true);
  assert.equal(validateCollectionName('a'.repeat(256)).ok, false);
});

// ── validateSnapshotName ────────────────────────────────────────────────────────
test('snapshot name: accepts a timestamped snapshot with colons + .snapshot', () => {
  assert.equal(validateSnapshotName('offgrid-brain-2024-01-01-10-00-00.snapshot').ok, true);
  assert.equal(validateSnapshotName('col:2024-01-01T10:00:00.snapshot').ok, true);
});

test('snapshot name: rejects empty, traversal, slashes', () => {
  assert.equal(validateSnapshotName('').ok, false);
  assert.equal(validateSnapshotName('..').ok, false);
  assert.equal(validateSnapshotName('a/../b').ok, false);
  assert.equal(validateSnapshotName('dir/snap.snapshot').ok, false);
  assert.equal(validateSnapshotName(null).ok, false);
});

test('snapshot name: rejects illegal chars', () => {
  assert.equal(validateSnapshotName('snap name.snapshot').ok, false);
  assert.equal(validateSnapshotName('snap?.snapshot').ok, false);
});

// ── normalizeCollectionNames ────────────────────────────────────────────────────
test('collection names: parses the {result:{collections:[...]}} envelope, dedupes', () => {
  const json = {
    result: { collections: [{ name: 'a' }, { name: 'b' }, { name: 'a' }, { name: '' }, {}] },
    status: 'ok',
  };
  assert.deepEqual(normalizeCollectionNames(json), ['a', 'b']);
});

test('collection names: garbage/absent → []', () => {
  assert.deepEqual(normalizeCollectionNames(null), []);
  assert.deepEqual(normalizeCollectionNames({}), []);
  assert.deepEqual(normalizeCollectionNames({ result: { collections: 'nope' } }), []);
});

// ── normalizeCollectionInfo ─────────────────────────────────────────────────────
test('collection info: parses status, counts, and single vector config', () => {
  const json = {
    result: {
      status: 'green',
      optimizer_status: 'ok',
      points_count: 1200,
      vectors_count: 1200,
      indexed_vectors_count: 1100,
      segments_count: 4,
      config: { params: { vectors: { size: 768, distance: 'Cosine' } } },
    },
  };
  const info = normalizeCollectionInfo('offgrid-brain', json);
  assert.equal(info.name, 'offgrid-brain');
  assert.equal(info.status, 'green');
  assert.equal(info.optimizerStatus, 'ok');
  assert.equal(info.pointsCount, 1200);
  assert.equal(info.indexedVectorsCount, 1100);
  assert.equal(info.segmentsCount, 4);
  assert.equal(info.vectorSize, 768);
  assert.equal(info.distance, 'Cosine');
});

test('collection info: null counts + named vector map leave vector fields null', () => {
  const json = {
    result: {
      status: 'yellow',
      vectors_count: null,
      config: { params: { vectors: { text: { size: 384, distance: 'Dot' } } } },
    },
  };
  const info = normalizeCollectionInfo('c', json);
  assert.equal(info.vectorsCount, null);
  assert.equal(info.pointsCount, null);
  assert.equal(info.vectorSize, null);
  assert.equal(info.distance, null);
});

test('collection info: object optimizer_status → error; missing → unknown; empty body safe', () => {
  assert.equal(
    normalizeCollectionInfo('c', { result: { optimizer_status: { error: 'boom' } } }).optimizerStatus,
    'error',
  );
  assert.equal(normalizeCollectionInfo('c', {}).optimizerStatus, 'unknown');
  assert.equal(normalizeCollectionInfo('c', {}).status, 'unknown');
  assert.equal(normalizeCollectionInfo('c', null).status, 'unknown');
});

test('collection info: non-numeric distance falls back to null', () => {
  const info = normalizeCollectionInfo('c', {
    result: { config: { params: { vectors: { size: 10, distance: 5 } } } },
  });
  assert.equal(info.vectorSize, 10);
  assert.equal(info.distance, null);
});

// ── toCollectionSummary ─────────────────────────────────────────────────────────
test('summary projection drops detail-only fields', () => {
  const info = normalizeCollectionInfo('c', {
    result: { status: 'green', points_count: 5, vectors_count: 5, segments_count: 2 },
  });
  assert.deepEqual(toCollectionSummary(info), {
    name: 'c',
    status: 'green',
    pointsCount: 5,
    vectorsCount: 5,
    segmentsCount: 2,
  });
});

// ── normalizeSnapshots ──────────────────────────────────────────────────────────
test('snapshots: parses rows, skips malformed, sorts newest first', () => {
  const json = {
    result: [
      { name: 'old.snapshot', size: 100, creation_time: '2024-01-01T00:00:00', checksum: 'x' },
      { name: 'new.snapshot', size: 200, creation_time: '2024-06-01T00:00:00' },
      { size: 5 }, // no name → skipped
      { name: '' }, // empty name → skipped
    ],
  };
  const rows = normalizeSnapshots(json);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'new.snapshot');
  assert.equal(rows[0].size, 200);
  assert.equal(rows[0].checksum, null);
  assert.equal(rows[1].name, 'old.snapshot');
  assert.equal(rows[1].checksum, 'x');
});

test('snapshots: undated rows sort last; non-array → []', () => {
  const rows = normalizeSnapshots({
    result: [{ name: 'undated.snapshot' }, { name: 'dated.snapshot', creation_time: '2024-01-01' }],
  });
  assert.equal(rows[0].name, 'dated.snapshot');
  assert.equal(rows[1].name, 'undated.snapshot');
  assert.equal(rows[1].size, null);
  assert.deepEqual(normalizeSnapshots({ result: 'nope' }), []);
  assert.deepEqual(normalizeSnapshots(null), []);
});

test('created snapshot: parses the single result; garbage → null', () => {
  const row = normalizeCreatedSnapshot({
    result: { name: 's.snapshot', size: 42, creation_time: '2024-01-01', checksum: 'abc' },
  });
  assert.deepEqual(row, {
    name: 's.snapshot',
    size: 42,
    creationTime: '2024-01-01',
    checksum: 'abc',
  });
  assert.equal(normalizeCreatedSnapshot({}), null);
  assert.equal(normalizeCreatedSnapshot({ result: { size: 1 } }), null);
});

// ── formatSize ──────────────────────────────────────────────────────────────────
test('formatSize: bytes, KB, MB, GB thresholds', () => {
  assert.equal(formatSize(0), '0 B');
  assert.equal(formatSize(512), '512 B');
  assert.equal(formatSize(1024), '1.0 KB');
  assert.equal(formatSize(1536), '1.5 KB');
  assert.equal(formatSize(1024 * 1024), '1.0 MB');
  assert.equal(formatSize(5 * 1024 * 1024 * 1024), '5.0 GB');
});

test('formatSize: null / negative / NaN → em dash', () => {
  assert.equal(formatSize(null), '—');
  assert.equal(formatSize(undefined), '—');
  assert.equal(formatSize(-1), '—');
  assert.equal(formatSize(Number.NaN), '—');
});

// ── buildRecoverRequest ─────────────────────────────────────────────────────────
test('recover: valid http location defaults priority to snapshot', () => {
  const r = buildRecoverRequest({ location: 'http://host:6333/collections/c/snapshots/s.snapshot' });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.request.priority, 'snapshot');
    assert.equal(r.request.checksum, undefined);
  }
});

test('recover: file:// + explicit priority + checksum are carried', () => {
  const r = buildRecoverRequest({
    location: 'file:///qdrant/snapshots/c/s.snapshot',
    priority: 'replica',
    checksum: '  deadbeef  ',
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.request.priority, 'replica');
    assert.equal(r.request.checksum, 'deadbeef');
  }
});

test('recover: rejects missing location, non-URL location, bad priority', () => {
  assert.equal(buildRecoverRequest({}).ok, false);
  assert.equal(buildRecoverRequest({ location: '   ' }).ok, false);
  assert.equal(buildRecoverRequest({ location: 'ftp://x/y' }).ok, false);
  assert.equal(buildRecoverRequest({ location: '/etc/passwd' }).ok, false);
  assert.equal(
    buildRecoverRequest({ location: 'http://x/y', priority: 'bogus' }).ok,
    false,
  );
});

test('recover: blank checksum is dropped, not carried as empty', () => {
  const r = buildRecoverRequest({ location: 'https://x/y', checksum: '   ' });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.request.checksum, undefined);
});

// ── snapshotDownloadPath ────────────────────────────────────────────────────────
test('download path: encodes both segments', () => {
  assert.equal(
    snapshotDownloadPath('offgrid-brain', 's.snapshot'),
    '/collections/offgrid-brain/snapshots/s.snapshot',
  );
  assert.equal(
    snapshotDownloadPath('a b', 's:1.snapshot'),
    '/collections/a%20b/snapshots/s%3A1.snapshot',
  );
});
