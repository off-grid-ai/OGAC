import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { test } from 'node:test';
import { presignS3Url } from '../src/lib/s3-sigv4.ts';
import {
  buildLifecycleXml,
  buildPublicReadPolicy,
  classifyBucketPolicy,
  normalizeLifecycleRule,
  parseLifecycleXml,
  type LifecycleRule,
} from '../src/lib/storage-lifecycle.ts';

// Pure, deterministic tests for the presigned-share signer and the lifecycle/policy payload logic.
// No I/O, no Date.now — the clock is injected. The signer is reproduced independently from the
// SigV4 spec so the test doesn't just mirror the implementation.

const FIXED = new Date('2026-07-05T12:00:00.000Z');
const AK = 'AKIAOFFGRIDTEST';
const SK = 'secretkey-abc123';

// ── Presign ───────────────────────────────────────────────────────────────────────────────────
test('presignS3Url: deterministic for a fixed clock + keys', () => {
  const a = presignS3Url({ url: `http://s3.local/media/photo.png`, accessKey: AK, secretKey: SK, expiresIn: 3600, date: FIXED });
  const b = presignS3Url({ url: `http://s3.local/media/photo.png`, accessKey: AK, secretKey: SK, expiresIn: 3600, date: FIXED });
  assert.equal(a, b);
});

test('presignS3Url: carries the required X-Amz query params', () => {
  const url = presignS3Url({ url: `http://s3.local/media/photo.png`, accessKey: AK, secretKey: SK, expiresIn: 900, date: FIXED });
  const q = new URL(url).searchParams;
  assert.equal(q.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.equal(q.get('X-Amz-Credential'), `${AK}/20260705/us-east-1/s3/aws4_request`);
  assert.equal(q.get('X-Amz-Date'), '20260705T120000Z');
  assert.equal(q.get('X-Amz-Expires'), '900');
  assert.equal(q.get('X-Amz-SignedHeaders'), 'host');
  assert.match(q.get('X-Amz-Signature') ?? '', /^[0-9a-f]{64}$/);
});

test('presignS3Url: clamps ttl to the S3 [1, 604800] range', () => {
  const over = new URL(presignS3Url({ url: 'http://s3.local/media/k', accessKey: AK, secretKey: SK, expiresIn: 999999999, date: FIXED }));
  assert.equal(over.searchParams.get('X-Amz-Expires'), '604800');
  const under = new URL(presignS3Url({ url: 'http://s3.local/media/k', accessKey: AK, secretKey: SK, expiresIn: 0, date: FIXED }));
  assert.equal(under.searchParams.get('X-Amz-Expires'), '1');
});

test('presignS3Url: a different secret yields a different signature', () => {
  const a = new URL(presignS3Url({ url: 'http://s3.local/media/k', accessKey: AK, secretKey: 's1', expiresIn: 60, date: FIXED }));
  const b = new URL(presignS3Url({ url: 'http://s3.local/media/k', accessKey: AK, secretKey: 's2', expiresIn: 60, date: FIXED }));
  assert.notEqual(a.searchParams.get('X-Amz-Signature'), b.searchParams.get('X-Amz-Signature'));
});

test('presignS3Url: the signature matches an independent SigV4 recomputation', () => {
  const host = 's3.local';
  const path = '/media/photo.png';
  const url = presignS3Url({ url: `http://${host}${path}`, accessKey: AK, secretKey: SK, expiresIn: 3600, date: FIXED });
  const parsed = new URL(url);
  const given = parsed.searchParams.get('X-Amz-Signature')!;

  // Rebuild the canonical query WITHOUT the signature (sorted, encoded), exactly as the signer does.
  const q = new URLSearchParams(parsed.search);
  q.delete('X-Amz-Signature');
  const pairs = [...q.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const canonicalQuery = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  const canonicalRequest = [
    'GET',
    path, // no special chars to encode here
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const scope = '20260705/us-east-1/s3/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256', '20260705T120000Z', scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const kDate = createHmac('sha256', `AWS4${SK}`).update('20260705').digest();
  const kRegion = createHmac('sha256', kDate).update('us-east-1').digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const expected = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  assert.equal(given, expected);
});

// ── Lifecycle rule normalisation ────────────────────────────────────────────────────────────────
test('normalizeLifecycleRule: rejects non-positive / non-numeric expiry', () => {
  assert.equal(normalizeLifecycleRule({ expireDays: 0 }), null);
  assert.equal(normalizeLifecycleRule({ expireDays: -5 }), null);
  assert.equal(normalizeLifecycleRule({ expireDays: 'abc' }), null);
  assert.equal(normalizeLifecycleRule({}), null);
});

test('normalizeLifecycleRule: derives an id, clamps days, defaults enabled', () => {
  const r = normalizeLifecycleRule({ prefix: 'tmp/', expireDays: 99999 });
  assert.ok(r);
  assert.equal(r!.prefix, 'tmp/');
  assert.equal(r!.expireDays, 3650); // clamped
  assert.equal(r!.enabled, true);
  assert.match(r!.id, /^expire-tmp\/-3650d$/);
});

test('normalizeLifecycleRule: honours explicit enabled:false and floors fractional days', () => {
  const r = normalizeLifecycleRule({ id: 'r1', prefix: '', expireDays: 7.9, enabled: false });
  assert.equal(r!.id, 'r1');
  assert.equal(r!.expireDays, 7);
  assert.equal(r!.enabled, false);
});

// ── Lifecycle XML round-trip ──────────────────────────────────────────────────────────────────
test('buildLifecycleXml → parseLifecycleXml round-trips rules', () => {
  const rules: LifecycleRule[] = [
    { id: 'expire-tmp', prefix: 'tmp/', expireDays: 30, enabled: true },
    { id: 'expire-logs', prefix: 'logs/', expireDays: 7, enabled: false },
  ];
  const xml = buildLifecycleXml(rules);
  assert.match(xml, /<LifecycleConfiguration/);
  const parsed = parseLifecycleXml(xml);
  assert.deepEqual(parsed, rules);
});

test('buildLifecycleXml: empty rule list = empty configuration (clears lifecycle)', () => {
  const xml = buildLifecycleXml([]);
  assert.match(xml, /<LifecycleConfiguration[^>]*><\/LifecycleConfiguration>/);
  assert.deepEqual(parseLifecycleXml(xml), []);
});

test('parseLifecycleXml: tolerates a bare v1 <Prefix> (no Filter wrapper) and ignores non-day rules', () => {
  const xml = `<LifecycleConfiguration>
    <Rule><ID>a</ID><Prefix>docs/</Prefix><Status>Enabled</Status><Expiration><Days>90</Days></Expiration></Rule>
    <Rule><ID>b</ID><Prefix>x/</Prefix><Status>Enabled</Status><Expiration><Date>2030-01-01T00:00:00Z</Date></Expiration></Rule>
  </LifecycleConfiguration>`;
  const parsed = parseLifecycleXml(xml);
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], { id: 'a', prefix: 'docs/', expireDays: 90, enabled: true });
});

test('buildLifecycleXml: escapes XML-special chars in id/prefix', () => {
  const xml = buildLifecycleXml([{ id: 'a&b', prefix: 'x<y>/', expireDays: 1, enabled: true }]);
  assert.match(xml, /a&amp;b/);
  assert.match(xml, /x&lt;y&gt;\//);
});

// ── Bucket policy ─────────────────────────────────────────────────────────────────────────────
test('buildPublicReadPolicy → classify = public', () => {
  const p = buildPublicReadPolicy('media');
  assert.match(p, /arn:aws:s3:::media\/\*/);
  assert.equal(classifyBucketPolicy(p), 'public');
});

test('classifyBucketPolicy: null / empty = private', () => {
  assert.equal(classifyBucketPolicy(null), 'private');
  assert.equal(classifyBucketPolicy(''), 'private');
});

test('classifyBucketPolicy: a Deny or non-star principal is private', () => {
  const deny = JSON.stringify({ Statement: [{ Effect: 'Deny', Principal: '*', Action: 's3:GetObject' }] });
  assert.equal(classifyBucketPolicy(deny), 'private');
  const scoped = JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::1:user/x' }, Action: 's3:GetObject' }] });
  assert.equal(classifyBucketPolicy(scoped), 'private');
});

test('classifyBucketPolicy: {AWS:"*"} principal form is public', () => {
  const p = JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: { AWS: '*' }, Action: ['s3:GetObject'] }] });
  assert.equal(classifyBucketPolicy(p), 'public');
});

test('classifyBucketPolicy: unparseable JSON = private (fail-safe)', () => {
  assert.equal(classifyBucketPolicy('{not json'), 'private');
});
