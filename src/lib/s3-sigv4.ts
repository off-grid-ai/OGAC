// Minimal, correct AWS SigV4 request signing for S3 (SeaweedFS with `identities.json` IAM).
//
// Phase 4.10-B: when the broker returns `{kind:'s3'}` keys for SeaweedFS, `files.ts` signs its raw-S3
// fetch()es with these instead of the anonymous loopback path. This is the only place the signing math
// lives — a self-contained, dependency-free implementation of the four SigV4 steps (canonical request
// → string-to-sign → signing key → Authorization header). No AWS SDK (we speak raw S3 over fetch to
// stay dependency-free, matching the aggregator's style).
//
// Region/service are fixed: SeaweedFS ignores the region but requires it to match between the
// credential scope and the signature, so we pin `us-east-1` / `s3`. Payloads are signed with a real
// SHA-256 body hash (UNSIGNED-PAYLOAD is avoided so no extra header contract is imposed on SeaweedFS).

import { createHash, createHmac } from 'node:crypto';

const REGION = 'us-east-1';
const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';

export interface SignInput {
  method: string;
  /** Absolute URL of the request (host + path + optional query). */
  url: string;
  /** Header name→value pairs the caller will send (e.g. content-type, x-amz-meta-*). */
  headers: Record<string, string>;
  /** Raw request body bytes (empty for GET/HEAD/DELETE). */
  body?: Uint8Array | string;
  accessKey: string;
  secretKey: string;
  /** Injectable clock for deterministic tests. Defaults to now. */
  date?: Date;
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** `YYYYMMDDTHHMMSSZ` and `YYYYMMDD` from a Date (UTC), the two SigV4 time formats. */
export function amzDates(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString(); // 2026-07-05T12:34:56.789Z
  const amzDate = iso.replace(/[:-]/g, '').replace(/\.\d{3}/, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * S3-flavoured URI encoding for the canonical path: encode every byte except the RFC-3986 unreserved
 * set, but DO NOT encode the '/' path separators (S3 canonicalises each segment, keeping slashes).
 * `URL.pathname` is ALREADY percent-encoded (WHATWG), so we decode each segment first to avoid
 * double-encoding (e.g. a literal space arrives as `%20` and must stay `%20`, not become `%2520`).
 */
function encodePath(path: string): string {
  return path
    .split('/')
    .map((seg) => {
      let decoded: string;
      try {
        decoded = decodeURIComponent(seg);
      } catch {
        decoded = seg; // malformed escape — sign it as-is
      }
      return encodeURIComponent(decoded).replace(
        /[!'()*]/g,
        (c) => '%' + c.codePointAt(0)!.toString(16).toUpperCase(),
      );
    })
    .join('/');
}

/** Canonical query string: params sorted by key, each key & value URI-encoded. */
function canonicalQuery(search: URLSearchParams): string {
  const pairs: [string, string][] = [];
  for (const [k, v] of search) pairs.push([k, v]);
  pairs.sort((a, b) => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    return a[1] < b[1] ? -1 : 1;
  });
  return pairs
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Sign an S3 request with SigV4. Returns the headers to ADD to the request: `authorization`,
 * `x-amz-date`, `x-amz-content-sha256`, and `host` (fetch sets host itself, but it must be part of the
 * signed set — we return it so callers/tests can see the signed value). Pure given `date`.
 */
export function signS3Request(input: SignInput): Record<string, string> {
  const { method, url, accessKey, secretKey } = input;
  const u = new URL(url);
  const { amzDate, dateStamp } = amzDates(input.date ?? new Date());

  const bodyBytes =
    input.body === undefined
      ? new Uint8Array(0)
      : typeof input.body === 'string'
        ? new TextEncoder().encode(input.body)
        : input.body;
  const payloadHash = sha256Hex(bodyBytes);

  // Assemble the headers to sign: caller headers + the SigV4-required host/date/content-hash.
  // Header names are lowercased and sorted for the canonical form.
  const signed: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers)) signed[k.toLowerCase()] = String(v).trim();
  signed['host'] = u.host;
  signed['x-amz-date'] = amzDate;
  signed['x-amz-content-sha256'] = payloadHash;

  const sortedNames = Object.keys(signed).sort();
  const canonicalHeaders = sortedNames.map((n) => `${n}:${signed[n]}\n`).join('');
  const signedHeaders = sortedNames.join(';');

  const canonicalRequest = [
    method.toUpperCase(),
    encodePath(u.pathname),
    canonicalQuery(u.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `${ALGORITHM} Credential=${accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    authorization,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    host: u.host,
  };
}

export interface PresignInput {
  method?: string;
  /** Absolute URL of the object (host + path). Any existing query is preserved and signed. */
  url: string;
  accessKey: string;
  secretKey: string;
  /** Link lifetime in seconds (1…604800 — S3 caps presigned URLs at 7 days). */
  expiresIn: number;
  /** Injectable clock for deterministic tests. Defaults to now. */
  date?: Date;
}

/**
 * Presign an S3 GET URL — the query-parameter variant of SigV4 (RFC: "Authenticating Requests: Using
 * Query Parameters"). Instead of an Authorization header, the credential/date/scope/signed-headers and
 * the final signature ride in the query string, so the URL alone grants time-limited read access with
 * no header contract on the client. `host` is the only signed header (a bare browser GET sends just
 * Host). The payload hash is the literal `UNSIGNED-PAYLOAD` sentinel that S3 mandates for presigned
 * URLs. Pure given `date` — returns the fully-signed absolute URL.
 */
export function presignS3Url(input: PresignInput): string {
  const method = (input.method ?? 'GET').toUpperCase();
  const u = new URL(input.url);
  const { amzDate, dateStamp } = amzDates(input.date ?? new Date());
  const expires = Math.max(1, Math.min(604800, Math.floor(input.expiresIn)));

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const signedHeaders = 'host';

  // Merge the required X-Amz-* presign params INTO the existing query, then canonicalise the whole set.
  const q = new URLSearchParams(u.search);
  q.set('X-Amz-Algorithm', ALGORITHM);
  q.set('X-Amz-Credential', `${input.accessKey}/${scope}`);
  q.set('X-Amz-Date', amzDate);
  q.set('X-Amz-Expires', String(expires));
  q.set('X-Amz-SignedHeaders', signedHeaders);

  const canonicalHeaders = `host:${u.host}\n`;
  const canonicalRequest = [
    method,
    encodePath(u.pathname),
    canonicalQuery(q),
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${input.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  q.set('X-Amz-Signature', signature);
  u.search = canonicalQuery(q);
  return u.toString();
}
