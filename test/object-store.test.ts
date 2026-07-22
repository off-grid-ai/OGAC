import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatBytes,
  keyBasename,
  mimeFromKey,
  parseListBucketsXml,
  parseListObjectsXml,
  parseS3ErrorCode,
  shapeObjectDetail,
  validateBucketName,
  validateObjectKey,
} from '../src/lib/object-store.ts';

// Pure, deterministic tests for the object-store logic layer — no I/O, no clock. The adapter's HTTP
// boundary is exercised separately in s3-object-store.test.ts.

// ── validateBucketName ──────────────────────────────────────────────────────────────────────────
test('validateBucketName: accepts a well-formed name', () => {
  assert.deepEqual(validateBucketName('suraksha-claims'), { ok: true });
  assert.deepEqual(validateBucketName('bharatunion.docs'), { ok: true });
  assert.deepEqual(validateBucketName('abc'), { ok: true });
});

test('validateBucketName: rejects empty / too short / too long', () => {
  assert.equal(validateBucketName('').ok, false);
  assert.equal(validateBucketName('ab').ok, false);
  assert.equal(validateBucketName('a'.repeat(64)).ok, false);
});

test('validateBucketName: rejects illegal characters and casing', () => {
  assert.equal(validateBucketName('Suraksha').ok, false); // uppercase
  assert.equal(validateBucketName('has space').ok, false);
  assert.equal(validateBucketName('under_score').ok, false);
});

test('validateBucketName: rejects bad start/end, double dots, IP form', () => {
  assert.equal(validateBucketName('-lead').ok, false);
  assert.equal(validateBucketName('trail-').ok, false);
  assert.equal(validateBucketName('a..b').ok, false);
  assert.equal(validateBucketName('192.168.0.1').ok, false);
  // a hyphen-only-ish but valid-length dotted name that is NOT an IP is fine
  assert.equal(validateBucketName('10.0.0.x').ok, true);
});

// ── validateObjectKey ─────────────────────────────────────────────────────────────────────────────
test('validateObjectKey: accepts nested keys', () => {
  assert.deepEqual(validateObjectKey('claims/2026/policy-4821.pdf'), { ok: true });
  assert.deepEqual(validateObjectKey('a.txt'), { ok: true });
});

test('validateObjectKey: rejects empty, leading slash, traversal, control chars, over-length', () => {
  assert.equal(validateObjectKey('').ok, false);
  assert.equal(validateObjectKey('/leading').ok, false);
  assert.equal(validateObjectKey('a/../b').ok, false);
  assert.equal(validateObjectKey('a/./b').ok, false);
  assert.equal(validateObjectKey('bad\tkey').ok, false);
  assert.equal(validateObjectKey('k'.repeat(1025)).ok, false);
});

// ── parseListBucketsXml ─────────────────────────────────────────────────────────────────────────
test('parseListBucketsXml: parses + sorts buckets, ISO dates', () => {
  const xml = `<?xml version="1.0"?><ListAllMyBucketsResult><Buckets>
    <Bucket><Name>suraksha-claims</Name><CreationDate>2026-01-02T03:04:05.000Z</CreationDate></Bucket>
    <Bucket><Name>bharatunion-docs</Name><CreationDate>2026-02-02T00:00:00.000Z</CreationDate></Bucket>
  </Buckets></ListAllMyBucketsResult>`;
  const rows = parseListBucketsXml(xml);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'bharatunion-docs'); // sorted
  assert.equal(rows[1].name, 'suraksha-claims');
  assert.equal(rows[1].createdAt, '2026-01-02T03:04:05.000Z');
});

test('parseListBucketsXml: empty / no buckets → []', () => {
  assert.deepEqual(parseListBucketsXml('<ListAllMyBucketsResult><Buckets></Buckets></ListAllMyBucketsResult>'), []);
});

test('parseListBucketsXml: bad creation date falls back to epoch', () => {
  const rows = parseListBucketsXml('<Buckets><Bucket><Name>x-bucket</Name><CreationDate>not-a-date</CreationDate></Bucket></Buckets>');
  assert.equal(rows[0].createdAt, new Date(0).toISOString());
});

// ── parseListObjectsXml ─────────────────────────────────────────────────────────────────────────
test('parseListObjectsXml: parses objects + common prefixes + truncation token', () => {
  const xml = `<ListBucketResult>
    <IsTruncated>true</IsTruncated>
    <NextContinuationToken>tok-123</NextContinuationToken>
    <Contents><Key>claims/a.pdf</Key><Size>2048</Size><LastModified>2026-03-01T00:00:00.000Z</LastModified><ETag>"abc"</ETag></Contents>
    <Contents><Key>claims/b.pdf</Key><Size>1024</Size><LastModified>2026-03-02T00:00:00.000Z</LastModified><ETag>"def"</ETag></Contents>
    <CommonPrefixes><Prefix>claims/archive/</Prefix></CommonPrefixes>
  </ListBucketResult>`;
  const listing = parseListObjectsXml(xml, 'claims/');
  assert.equal(listing.objects.length, 2);
  assert.equal(listing.objects[0].key, 'claims/a.pdf');
  assert.equal(listing.objects[0].size, 2048);
  assert.equal(listing.objects[0].etag, 'abc'); // quotes stripped
  assert.deepEqual(listing.folders, ['claims/archive/']);
  assert.equal(listing.nextToken, 'tok-123');
  assert.equal(listing.prefix, 'claims/');
});

test('parseListObjectsXml: skips the prefix folder-marker key + not-truncated → null token', () => {
  const xml = `<ListBucketResult>
    <IsTruncated>false</IsTruncated>
    <Contents><Key>claims/</Key><Size>0</Size><LastModified>2026-03-01T00:00:00.000Z</LastModified></Contents>
    <Contents><Key>claims/real.pdf</Key><Size>10</Size><LastModified>2026-03-01T00:00:00.000Z</LastModified></Contents>
  </ListBucketResult>`;
  const listing = parseListObjectsXml(xml, 'claims/');
  assert.equal(listing.objects.length, 1);
  assert.equal(listing.objects[0].key, 'claims/real.pdf');
  assert.equal(listing.nextToken, null);
});

test('parseListObjectsXml: empty listing', () => {
  const listing = parseListObjectsXml('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
  assert.deepEqual(listing.objects, []);
  assert.deepEqual(listing.folders, []);
  assert.equal(listing.nextToken, null);
  assert.equal(listing.prefix, '');
});

test('parseListObjectsXml: unescapes XML entities in keys', () => {
  const xml = `<ListBucketResult><Contents><Key>a &amp; b/c.txt</Key><Size>1</Size><LastModified>2026-01-01T00:00:00Z</LastModified></Contents></ListBucketResult>`;
  const listing = parseListObjectsXml(xml);
  assert.equal(listing.objects[0].key, 'a & b/c.txt');
});

// ── parseS3ErrorCode ────────────────────────────────────────────────────────────────────────────
test('parseS3ErrorCode: extracts the Code, null when absent', () => {
  assert.equal(parseS3ErrorCode('<Error><Code>BucketNotEmpty</Code></Error>'), 'BucketNotEmpty');
  assert.equal(parseS3ErrorCode('<html>oops</html>'), null);
});

// ── shapeObjectDetail ───────────────────────────────────────────────────────────────────────────
test('shapeObjectDetail: maps headers + decodes x-amz-meta-*', () => {
  const d = shapeObjectDetail('suraksha-claims', 'claims/policy.pdf', {
    'content-length': '4096',
    'content-type': 'application/pdf',
    'last-modified': 'Wed, 01 Jan 2026 00:00:00 GMT',
    etag: '"xyz"',
    'x-amz-meta-name': 'Policy%20%234821',
    'x-amz-meta-owner': 'ops%40suraksha.example',
    'unrelated-header': 'ignored',
  });
  assert.equal(d.bucket, 'suraksha-claims');
  assert.equal(d.size, 4096);
  assert.equal(d.contentType, 'application/pdf');
  assert.equal(d.etag, 'xyz');
  assert.equal(d.metadata.name, 'Policy #4821');
  assert.equal(d.metadata.owner, 'ops@suraksha.example');
  assert.equal(d.metadata['unrelated-header'], undefined);
});

test('shapeObjectDetail: keeps a malformed meta value raw, defaults content-type', () => {
  const d = shapeObjectDetail('b-ucket', 'k', { 'x-amz-meta-x': '%E0%A4%A' });
  assert.equal(d.metadata.x, '%E0%A4%A');
  assert.equal(d.contentType, 'application/octet-stream');
  assert.equal(d.size, 0);
});

// ── formatBytes ─────────────────────────────────────────────────────────────────────────────────
test('formatBytes: scales across units + guards bad input', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatBytes(3 * 1024 * 1024 * 1024), '3.0 GB');
  assert.equal(formatBytes(2 * 1024 ** 4), '2.0 TB');
  assert.equal(formatBytes(-5), '0 B');
  assert.equal(formatBytes(NaN), '0 B');
});

// ── keyBasename / mimeFromKey ─────────────────────────────────────────────────────────────────────
test('keyBasename: last segment, trailing slash tolerated', () => {
  assert.equal(keyBasename('claims/2026/policy.pdf'), 'policy.pdf');
  assert.equal(keyBasename('claims/archive/'), 'archive');
  assert.equal(keyBasename('flat.txt'), 'flat.txt');
});

test('mimeFromKey: by extension, octet-stream fallback', () => {
  assert.equal(mimeFromKey('a/b/photo.PNG'), 'image/png');
  assert.equal(mimeFromKey('data/rows.parquet'), 'application/vnd.apache.parquet');
  assert.equal(mimeFromKey('noext'), 'application/octet-stream');
});
