import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { test } from 'node:test';
import {
  chooseFleetToken,
  chooseGatewayAuth,
  chooseLangfuseAuth,
  type ServiceCredential,
} from '../src/lib/service-credentials-lib.ts';
import { amzDates, signS3Request } from '../src/lib/s3-sigv4.ts';

// Phase 4.10-B: the PURE auth-selection rules every adapter shares, plus the S3 SigV4 signer. No I/O,
// no network — exercised against real credential shapes. The load-bearing property is FAIL-SAFE: when
// the broker returns `kind:'none'` (the unprovisioned reality), the output is byte-identical to what
// each adapter emitted before the broker existed.

const NONE: ServiceCredential = { kind: 'none' };
const bearer = (token: string): ServiceCredential => ({ kind: 'bearer', token });
const s3 = (accessKey: string, secretKey: string): ServiceCredential => ({ kind: 's3', accessKey, secretKey });
const b64 = (s: string) => Buffer.from(s).toString('base64');

// ── Gateway ─────────────────────────────────────────────────────────────────────
test('gateway: broker Bearer wins over the legacy x-api-key', () => {
  assert.deepEqual(chooseGatewayAuth(bearer('jwt-123'), 'legacy-key'), {
    authorization: 'Bearer jwt-123',
  });
});

test('gateway: none → legacy x-api-key (byte-identical to today)', () => {
  assert.deepEqual(chooseGatewayAuth(NONE, 'legacy-key'), { 'x-api-key': 'legacy-key' });
});

test('gateway: none + no legacy key → no auth header at all (unchanged)', () => {
  assert.deepEqual(chooseGatewayAuth(NONE, undefined), {});
  assert.deepEqual(chooseGatewayAuth(NONE, ''), {});
});

test('gateway: an empty bearer token does not shadow the legacy key', () => {
  assert.deepEqual(chooseGatewayAuth(bearer(''), 'legacy-key'), { 'x-api-key': 'legacy-key' });
});

// ── Fleet ───────────────────────────────────────────────────────────────────────
test('fleet: broker Bearer wins over the legacy static token', () => {
  assert.equal(chooseFleetToken(bearer('svc-jwt'), 'FLEET_STATIC'), 'svc-jwt');
});

test('fleet: none → legacy static token (byte-identical to today)', () => {
  assert.equal(chooseFleetToken(NONE, 'FLEET_STATIC'), 'FLEET_STATIC');
});

test('fleet: none + no legacy token → undefined (→ no Authorization header, unchanged)', () => {
  assert.equal(chooseFleetToken(NONE, undefined), undefined);
});

// ── Langfuse ──────────────────────────────────────────────────────────────────────
test('langfuse: broker keypair → Basic base64(pk:sk), preferred over env', () => {
  const legacy = `Basic ${b64('env-pk:env-sk')}`;
  assert.equal(
    chooseLangfuseAuth(s3('pk-lf-x', 'sk-lf-y'), legacy, b64),
    `Basic ${b64('pk-lf-x:sk-lf-y')}`,
  );
});

test('langfuse: none → legacy env Basic header verbatim (byte-identical to today)', () => {
  const legacy = `Basic ${b64('env-pk:env-sk')}`;
  assert.equal(chooseLangfuseAuth(NONE, legacy, b64), legacy);
});

test('langfuse: none + no env → null (read-back "not configured", unchanged)', () => {
  assert.equal(chooseLangfuseAuth(NONE, null, b64), null);
});

// ── S3 SigV4 ────────────────────────────────────────────────────────────────────
test('amzDates formats the two SigV4 time strings from a Date', () => {
  const { amzDate, dateStamp } = amzDates(new Date('2026-07-05T12:34:56.789Z'));
  assert.equal(amzDate, '20260705T123456Z');
  assert.equal(dateStamp, '20260705');
});

test('signS3Request produces a well-formed, deterministic Authorization for a fixed clock', () => {
  const date = new Date('2026-07-05T00:00:00.000Z');
  const h = signS3Request({
    method: 'GET',
    url: 'http://127.0.0.1:8333/media/some-key.png',
    headers: {},
    accessKey: 'AKIAEXAMPLE',
    secretKey: 'secret-key-value',
    date,
  });
  // Header set the caller must send.
  assert.equal(h['x-amz-date'], '20260705T000000Z');
  // GET with no body → SHA-256 of empty string.
  assert.equal(
    h['x-amz-content-sha256'],
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.match(
    h.authorization,
    /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20260705\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
  );
  // Deterministic: same inputs → same signature.
  const h2 = signS3Request({
    method: 'GET',
    url: 'http://127.0.0.1:8333/media/some-key.png',
    headers: {},
    accessKey: 'AKIAEXAMPLE',
    secretKey: 'secret-key-value',
    date,
  });
  assert.equal(h.authorization, h2.authorization);
});

test('signS3Request: the signing key follows the AWS4 HMAC chain (independently reproduced)', () => {
  // Reproduce the SigV4 signing-key derivation independently and confirm the signature the signer
  // emits matches a from-scratch computation of the same canonical request. This pins correctness of
  // the four-step chain without a live S3.
  const date = new Date('2026-07-05T00:00:00.000Z');
  const secretKey = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  const accessKey = 'AKIDEXAMPLE';
  const url = 'http://127.0.0.1:8333/media/a/b%20c.txt';

  const out = signS3Request({ method: 'HEAD', url, headers: {}, accessKey, secretKey, date });

  // Rebuild canonical request the same way the signer does.
  const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const canonicalHeaders =
    `host:127.0.0.1:8333\nx-amz-content-sha256:${emptyHash}\nx-amz-date:20260705T000000Z\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  // Path is per-segment encoded, slashes preserved; %20 stays encoded.
  const canonicalRequest = [
    'HEAD',
    '/media/a/b%20c.txt',
    '',
    canonicalHeaders,
    signedHeaders,
    emptyHash,
  ].join('\n');
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const scope = '20260705/us-east-1/s3/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256', '20260705T000000Z', scope, hash(canonicalRequest)].join('\n');
  const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d, 'utf8').digest();
  const kDate = hmac(`AWS4${secretKey}`, '20260705');
  const kRegion = hmac(kDate, 'us-east-1');
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const expected = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  assert.ok(out.authorization.endsWith(`Signature=${expected}`), 'signature must match the AWS4 chain');
});

test('signS3Request: changing the secret changes the signature', () => {
  const date = new Date('2026-07-05T00:00:00.000Z');
  const a = signS3Request({ method: 'GET', url: 'http://h/media/k', headers: {}, accessKey: 'AK', secretKey: 's1', date });
  const b = signS3Request({ method: 'GET', url: 'http://h/media/k', headers: {}, accessKey: 'AK', secretKey: 's2', date });
  assert.notEqual(a.authorization, b.authorization);
});

test('signS3Request: a body is hashed into x-amz-content-sha256 (not the empty hash)', () => {
  const date = new Date('2026-07-05T00:00:00.000Z');
  const body = new TextEncoder().encode('hello world');
  const h = signS3Request({
    method: 'PUT',
    url: 'http://h/media/k',
    headers: { 'content-type': 'text/plain' },
    body,
    accessKey: 'AK',
    secretKey: 'sk',
    date,
  });
  assert.notEqual(
    h['x-amz-content-sha256'],
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  // content-type is a signed header → appears in SignedHeaders, sorted.
  assert.match(h.authorization, /SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date/);
});
