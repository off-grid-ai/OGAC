// SeaweedFS S3 object-store adapter — the I/O shell behind the ObjectStorePort.
//
// This is the GENERIC, multi-bucket S3 client for the data-lake management surface: list/create/
// delete buckets, list/put/get/delete objects in ANY bucket, and read/write a bucket's lifecycle.
// It is deliberately separate from src/lib/files.ts (which is hard-wired to the single `media`
// bucket for console file uploads) — this one takes the bucket as a parameter for every call.
//
// Signing: every request goes through the ONE `s3Fetch` seam. If the service-token broker has an S3
// keypair for SeaweedFS (getServiceCredential('seaweedfs') → kind:'s3'), the request is SigV4-signed
// with the shared pure signer (s3-sigv4.ts — the single source of truth for signing). If the broker
// returns kind:'none' (anonymous loopback SeaweedFS, the current fleet default), the request is issued
// unsigned — byte-identical to files.ts's behaviour, so both clients speak to the box the same way.
//
// SOLID: NO business rules here. All validation / XML parsing / row shaping is the pure object-store.ts
// layer; this file only moves bytes and hands raw XML/headers to those pure functions.

import {
  parseListBucketsXml,
  parseListObjectsXml,
  parseS3ErrorCode,
  shapeObjectDetail,
  type BucketRow,
  type ObjectDetail,
  type ObjectListing,
} from '@/lib/object-store';
import { signS3Request } from '@/lib/s3-sigv4';
import { getServiceCredential } from '@/lib/service-credentials';
import { buildLifecycleXml, parseLifecycleXml, type LifecycleRule } from '@/lib/storage-lifecycle';

const S3 = (process.env.OFFGRID_SEAWEEDFS_URL || 'http://127.0.0.1:8333').replace(/\/$/, '');

/** Is an object-store endpoint configured at all? (URL always defaults, so this is effectively true;
 *  kept as a seam so the surface can degrade to an honest "unconfigured" state if we ever gate it.) */
export function isObjectStoreConfigured(): boolean {
  return Boolean(S3);
}

/** Percent-encode a key for the URL path, PRESERVING slashes (so nested keys address the right object). */
function keyPath(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

// The one S3 request seam — SigV4-signs when a keypair is provisioned, else issues unsigned.
type S3Credential = Awaited<ReturnType<typeof getServiceCredential>>;
type S3CredentialResolver = () => Promise<S3Credential>;

async function s3Fetch(
  url: string,
  init: RequestInit & { body?: Uint8Array } = {},
  credential: S3CredentialResolver = () => getServiceCredential('seaweedfs'),
): Promise<Response> {
  const cred = await credential();
  if (cred.kind !== 's3') return fetch(url, init);
  const method = (init.method ?? 'GET').toUpperCase();
  const callerHeaders = (init.headers as Record<string, string>) ?? {};
  const signed = signS3Request({
    method,
    url,
    headers: callerHeaders,
    body: init.body,
    accessKey: cred.accessKey,
    secretKey: cred.secretKey,
  });
  const { host: _host, ...authHeaders } = signed;
  return fetch(url, { ...init, headers: { ...callerHeaders, ...authHeaders } });
}

async function errorContext(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  const code = parseS3ErrorCode(body);
  return code ? `${code} (${res.status})` : `HTTP ${res.status}`;
}

// ── Port interface ─────────────────────────────────────────────────────────────────────────────
export interface GetObjectResult {
  bytes: Buffer;
  contentType: string;
  size: number;
}

export interface LifecyclePortState {
  supported: boolean;
  rules: LifecycleRule[];
  note?: string;
}

/** The object-store capability, as consumed by the storage routes. Swappable/mocked at this seam. */
export interface ObjectStorePort {
  health(): Promise<boolean>;
  listBuckets(): Promise<BucketRow[]>;
  createBucket(name: string): Promise<void>;
  deleteBucket(name: string): Promise<void>;
  listObjects(
    bucket: string,
    opts?: { prefix?: string; delimiter?: string; token?: string; maxKeys?: number },
  ): Promise<ObjectListing>;
  headObject(bucket: string, key: string): Promise<ObjectDetail | null>;
  putObject(
    bucket: string,
    key: string,
    body: Buffer,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<void>;
  getObject(bucket: string, key: string): Promise<GetObjectResult | null>;
  deleteObject(bucket: string, key: string): Promise<boolean>;
  getLifecycle(bucket: string): Promise<LifecyclePortState>;
  setLifecycle(bucket: string, rules: LifecycleRule[]): Promise<LifecyclePortState>;
}

export interface S3ObjectStoreConfig {
  endpoint: string;
  credential?: S3CredentialResolver;
}

/** Two real S3 endpoints share this one port implementation; callers only supply endpoint + auth. */
export function createS3ObjectStore(config: S3ObjectStoreConfig): ObjectStorePort {
  const parsed = new URL(config.endpoint);
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new TypeError('S3 endpoint must be a credential-free http(s) origin or base path.');
  }
  const endpoint = config.endpoint.replace(/\/$/, '');
  const credential = config.credential ?? (() => getServiceCredential('seaweedfs'));
  const request = (url: string, init?: RequestInit & { body?: Uint8Array }) =>
    s3Fetch(url, init, credential);

  return {
    async health() {
      try {
        const res = await request(endpoint, { method: 'GET', signal: AbortSignal.timeout(2500) });
        return res.ok || res.status === 403;
      } catch {
        return false;
      }
    },

    async listBuckets() {
      const res = await request(endpoint, { method: 'GET' });
      if (!res.ok) throw new Error(`listBuckets failed: ${await errorContext(res)}`);
      return parseListBucketsXml(await res.text());
    },

    async createBucket(name) {
      const res = await request(`${endpoint}/${encodeURIComponent(name)}`, { method: 'PUT' });
      // 200 created; 409 BucketAlreadyOwnedByYou is idempotent-OK.
      if (!res.ok && res.status !== 409)
        throw new Error(`createBucket failed: ${await errorContext(res)}`);
    },

    async deleteBucket(name) {
      const res = await request(`${endpoint}/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404)
        throw new Error(`deleteBucket failed: ${await errorContext(res)}`);
    },

    async listObjects(bucket, opts = {}) {
      const prefix = opts.prefix ?? '';
      const delimiter = opts.delimiter ?? '/';
      const params = new URLSearchParams({
        'list-type': '2',
        'max-keys': String(Math.max(1, Math.min(opts.maxKeys ?? 1000, 1000))),
      });
      if (prefix) params.set('prefix', prefix);
      if (delimiter) params.set('delimiter', delimiter);
      if (opts.token) params.set('continuation-token', opts.token);
      const res = await request(`${endpoint}/${encodeURIComponent(bucket)}?${params.toString()}`, {
        method: 'GET',
      });
      if (!res.ok) throw new Error(`listObjects failed: ${await errorContext(res)}`);
      return parseListObjectsXml(await res.text(), prefix);
    },

    async headObject(bucket, key) {
      const res = await request(`${endpoint}/${encodeURIComponent(bucket)}/${keyPath(key)}`, {
        method: 'HEAD',
      });
      if (!res.ok) return null;
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      return shapeObjectDetail(bucket, key, headers);
    },

    async putObject(bucket, key, body, contentType, metadata) {
      const metaHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(metadata ?? {}))
        metaHeaders[`x-amz-meta-${k}`] = encodeURIComponent(v);
      const res = await request(`${endpoint}/${encodeURIComponent(bucket)}/${keyPath(key)}`, {
        method: 'PUT',
        headers: { 'content-type': contentType || 'application/octet-stream', ...metaHeaders },
        body: new Uint8Array(body),
      });
      if (!res.ok) throw new Error(`putObject failed: ${await errorContext(res)}`);
    },

    async getObject(bucket, key) {
      const res = await request(`${endpoint}/${encodeURIComponent(bucket)}/${keyPath(key)}`, {
        method: 'GET',
      });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        bytes: buf,
        contentType: res.headers.get('content-type') || 'application/octet-stream',
        size: buf.length,
      };
    },

    async deleteObject(bucket, key) {
      const res = await request(`${endpoint}/${encodeURIComponent(bucket)}/${keyPath(key)}`, {
        method: 'DELETE',
      });
      return res.ok || res.status === 204;
    },

    async getLifecycle(bucket) {
      const res = await request(`${endpoint}/${encodeURIComponent(bucket)}?lifecycle=`, {
        method: 'GET',
      });
      if (res.status === 404 || res.status === 204) return { supported: true, rules: [] };
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (/NoSuchLifecycleConfiguration/i.test(body)) return { supported: true, rules: [] };
        if (res.status === 501 || res.status === 405)
          return {
            supported: false,
            rules: [],
            note: `SeaweedFS S3 returned ${res.status} for GetBucketLifecycle`,
          };
        return { supported: false, rules: [], note: `lifecycle read failed (${res.status})` };
      }
      return { supported: true, rules: parseLifecycleXml(await res.text()) };
    },

    async setLifecycle(bucket, rules) {
      const res = await request(`${endpoint}/${encodeURIComponent(bucket)}?lifecycle=`, {
        method: 'PUT',
        headers: { 'content-type': 'application/xml' },
        body: new Uint8Array(Buffer.from(buildLifecycleXml(rules))),
      });
      if (!res.ok) {
        if (res.status === 501 || res.status === 405)
          return {
            supported: false,
            rules: [],
            note: `SeaweedFS S3 returned ${res.status} for PutBucketLifecycle`,
          };
        const body = await res.text().catch(() => '');
        return {
          supported: false,
          rules: [],
          note: `lifecycle write failed (${res.status}) ${body.slice(0, 200)}`,
        };
      }
      return this.getLifecycle(bucket);
    },
  };
}

// ── SeaweedFS implementation ─────────────────────────────────────────────────────────────────────
// Byte-compatible default: same endpoint and service-token credential owner as before.
export const seaweedfsObjectStore: ObjectStorePort = createS3ObjectStore({ endpoint: S3 });
