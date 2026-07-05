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

import { createHash, createHmac } from 'crypto';

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
        (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
      );
    })
    .join('/');
}

/** Canonical query string: params sorted by key, each key & value URI-encoded. */
function canonicalQuery(search: URLSearchParams): string {
  const pairs: [string, string][] = [];
  for (const [k, v] of search) pairs.push([k, v]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
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
