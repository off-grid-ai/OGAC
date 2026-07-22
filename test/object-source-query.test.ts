import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_OBJECT_SOURCE_AGGREGATE_BYTES,
  MAX_OBJECT_SOURCE_BYTES,
  MAX_OBJECT_SOURCE_OBJECTS,
  fullObjectSourceKey,
  materializeObjectSourceRow,
  normalizeObjectSourceQuery,
  sameObjectSourceDetail,
  selectListedObjectKeys,
  validateObjectSourceAggregate,
} from '../src/lib/object-source-query.ts';
import type { ObjectAccessScope, ObjectDetail } from '../src/lib/object-store.ts';

const scope: ObjectAccessScope = {
  domainId: 'dom_claims',
  domainLabel: 'Claim evidence',
  connectorId: 'con_s3',
  bucket: 'claims-archive',
  prefix: 'approved/',
};

function detail(overrides: Partial<ObjectDetail> = {}): ObjectDetail {
  return {
    bucket: scope.bucket,
    key: 'approved/case-1.json',
    size: 11,
    contentType: 'application/json',
    lastModified: '2026-07-23T00:00:00.000Z',
    etag: 'etag-1',
    metadata: {},
    ...overrides,
  };
}

test('query normalization clamps caller limits and rejects ambiguous key/prefix input', () => {
  assert.deepEqual(normalizeObjectSourceQuery({ limit: 10_000, params: { prefix: 'cases' } }), {
    ok: true,
    value: { op: 'read', limit: MAX_OBJECT_SOURCE_OBJECTS, key: null, prefix: 'cases' },
  });
  assert.equal(normalizeObjectSourceQuery({ params: { key: '../private' } }).ok, true);
  assert.equal(fullObjectSourceKey(scope, '../private').ok, false);
  assert.equal(normalizeObjectSourceQuery({ params: { key: 'a', prefix: 'b' } }).ok, false);
  assert.equal(normalizeObjectSourceQuery({ op: 'count', params: { key: 'a' } }).ok, false);
  assert.equal(normalizeObjectSourceQuery({ limit: 0 }).ok, false);
  assert.equal(normalizeObjectSourceQuery({ params: { prefix: 42 } }).ok, false);
  assert.equal(normalizeObjectSourceQuery({ params: { prefix: '   ' } }).ok, false);
});

test('a mixed-prefix listing fails whole before any out-of-scope key can be selected', () => {
  const result = selectListedObjectKeys(
    scope,
    {
      prefix: 'approved/',
      folders: [],
      nextToken: null,
      objects: [
        { key: 'approved/one.txt', size: 1, lastModified: '', etag: 'one' },
        { key: 'private/two.txt', size: 1, lastModified: '', etag: 'two' },
      ],
    },
    20,
  );
  assert.deepEqual(result, {
    ok: false,
    error: { code: 'scope-denied', message: 'Object listing escaped the approved prefix.' },
  });

  const hiddenAfterLimit = selectListedObjectKeys(
    scope,
    {
      prefix: 'approved/',
      folders: [],
      nextToken: null,
      objects: [
        { key: 'approved/one.txt', size: 1, lastModified: '', etag: 'one' },
        { key: 'private/hidden.txt', size: 1, lastModified: '', etag: 'hidden' },
      ],
    },
    1,
  );
  assert.equal(hiddenAfterLimit.ok, false);

  const wrongRequestedFolder = selectListedObjectKeys(
    scope,
    {
      prefix: 'approved/cases/',
      folders: [],
      nextToken: null,
      objects: [{ key: 'approved/notes/one.txt', size: 1, lastModified: '', etag: 'one' }],
    },
    20,
    'approved/cases/',
  );
  assert.equal(wrongRequestedFolder.ok, false);
});

test('materialization retains full provenance and rejects metadata drift or unsafe content', () => {
  const bytes = Buffer.from('{"ok":true}');
  const row = materializeObjectSourceRow({
    scope,
    detail: detail(),
    bytes,
    getContentType: 'application/json',
  });
  assert.equal(row.ok, true);
  if (row.ok) {
    assert.equal(row.value.key, 'case-1.json');
    assert.equal(row.value.provenance.etag, 'etag-1');
    assert.equal(row.value.provenance.sha256.length, 64);
  }
  assert.equal(
    materializeObjectSourceRow({
      scope,
      detail: detail({ size: 12 }),
      bytes,
      getContentType: 'application/json',
    }).ok,
    false,
  );
  assert.equal(
    materializeObjectSourceRow({
      scope,
      detail: detail({ etag: '' }),
      bytes,
      getContentType: 'application/json',
    }).ok,
    false,
  );
  assert.equal(
    materializeObjectSourceRow({
      scope,
      detail: detail({ bucket: 'foreign-bucket' }),
      bytes,
      getContentType: 'application/json',
    }).ok,
    false,
  );
  assert.equal(
    materializeObjectSourceRow({
      scope,
      detail: detail({ contentType: 'application/pdf' }),
      bytes,
      getContentType: 'application/pdf',
    }).ok,
    false,
  );
  assert.equal(
    materializeObjectSourceRow({
      scope,
      detail: detail({ size: MAX_OBJECT_SOURCE_BYTES + 1 }),
      bytes,
      getContentType: 'application/json',
    }).ok,
    false,
  );
  assert.equal(
    materializeObjectSourceRow({
      scope,
      detail: detail({ size: 8 }),
      bytes: Buffer.from('not-json'),
      getContentType: 'application/json',
    }).ok,
    false,
  );
  assert.equal(sameObjectSourceDetail(detail(), detail()), true);
  assert.equal(sameObjectSourceDetail(detail(), detail({ etag: 'replacement' })), false);
  assert.equal(
    sameObjectSourceDetail(detail(), detail({ lastModified: '2026-07-23T00:00:01.000Z' })),
    false,
  );
});

test('aggregate content cannot exceed one MiB even when every object is individually valid', () => {
  const row = {
    key: 'one.txt',
    contentType: 'text/plain',
    size: MAX_OBJECT_SOURCE_BYTES,
    content: '',
    provenance: {
      connectorId: 'c',
      domainId: 'd',
      bucket: 'b',
      key: 'k',
      etag: 'e',
      lastModified: '',
      sha256: 'a'.repeat(64),
    },
  };
  assert.equal(validateObjectSourceAggregate([row, row]).ok, true);
  assert.equal(validateObjectSourceAggregate([row, row, { ...row, size: 1 }]).ok, false);
  assert.equal(MAX_OBJECT_SOURCE_AGGREGATE_BYTES, 1024 * 1024);
});
