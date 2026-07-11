// File storage service — SeaweedFS (S3) is the ONE and ONLY file-storage backend for the
// whole console: Storage, knowledge-base uploads, artifacts, everything. No local disk, no
// Postgres blob table, no parallel mechanism. Bytes AND metadata live in the `media` bucket
// (metadata as S3 object user-metadata), so the bucket is the single source of truth — a file
// uploaded straight to the bucket (e.g. via gateway.getoffgridai.co/files) shows up here too.
//
// SeaweedFS runs with `-s3` and no identity config, so its S3 API accepts anonymous requests
// on the loopback interface — no SigV4 signing needed. We speak raw S3 over fetch to stay
// dependency-free (matching the aggregator's style).
//
// Phase 4.10-B: when the service-token broker (`getServiceCredential('seaweedfs')`) has an S3 keypair
// provisioned in OpenBao (SeaweedFS gets an `identities.json`), every request is SigV4-signed with it.
// Until then the broker returns `kind:'none'` and we fall back to the current ANONYMOUS loopback
// behavior UNCHANGED — byte-identical requests to today, so nothing breaks pre-deploy. All S3 calls go
// through the one `s3Fetch` seam so signing is applied uniformly (or not at all).

import { orgFilePrefix, isKeyInOrg } from './files-tenancy';
import { presignS3Url, signS3Request } from './s3-sigv4';
import { getServiceCredential } from './service-credentials';
import {
  buildLifecycleXml,
  buildPublicReadPolicy,
  classifyBucketPolicy,
  parseLifecycleXml,
  type LifecycleRule,
} from './storage-lifecycle';

const S3 = (process.env.OFFGRID_SEAWEEDFS_URL || 'http://127.0.0.1:8333').replace(/\/$/, '');
const BUCKET = process.env.OFFGRID_SEAWEEDFS_BUCKET || 'media';
const base = `${S3}/${BUCKET}`;

// The one S3 request seam. Fetches the broker credential; if it's an S3 keypair, SigV4-signs the
// request (adds authorization + x-amz-date + x-amz-content-sha256). If it's `none` (unprovisioned),
// the request is issued EXACTLY as before — same URL, same method, same headers, no signing.
async function s3Fetch(url: string, init: RequestInit & { body?: Uint8Array } = {}): Promise<Response> {
  const cred = await getServiceCredential('seaweedfs');
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
  // fetch sets Host itself; drop the signer's host echo so we don't fight it. Everything else (the
  // caller's headers + the SigV4 auth/date/content-hash) is sent as-is.
  const { host: _host, ...authHeaders } = signed;
  return fetch(url, { ...init, headers: { ...callerHeaders, ...authHeaders } });
}
const PUBLIC_BASE = (process.env.OFFGRID_PUBLIC_BASE || 'https://gateway.getoffgridai.co').replace(/\/$/, '');

// The internet-reachable read URL for an object — the gateway's SeaweedFS path (serves the
// bucket read-only). Single source of truth for file URLs across the console.
export function publicUrlFor(id: string): string {
  const key = id.split('/').map(encodeURIComponent).join('/'); // preserve slashes in nested keys
  return `${PUBLIC_BASE}/files/${BUCKET}/${key}`;
}

export interface FileMeta {
  id: string; // the S3 object key
  name: string;
  mime: string;
  size: number;
  visibility: 'public' | 'private';
  owner: string;
  createdAt: string;
}

// Ensure the bucket exists (idempotent — 409/200 both fine). Named ensureFileSchema for
// drop-in compatibility with the previous disk+Postgres store's callers.
let ensurePromise: Promise<void> | null = null;
export async function ensureFileSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await s3Fetch(base, { method: 'PUT' }).catch(() => {}); // create bucket; ignore "already exists"
  })().catch((e) => { ensurePromise = null; throw e; });
  return ensurePromise;
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  pdf: 'application/pdf', json: 'application/json', txt: 'text/plain', csv: 'text/csv',
  md: 'text/markdown', zip: 'application/zip',
};
function mimeFromName(name: string): string {
  return EXT_MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}
// Object keys are slash-free for console uploads so the /api/v1/files/[id] route can address
// them; the original filename is preserved in metadata. Strip anything path-like.
function safeName(name: string): string {
  return (name || 'file').replace(/[/\\]+/g, '_').slice(0, 200);
}

// Encode an object key for the S3 URL path, PRESERVING slashes so a tenant-prefixed key
// (`orgs/<org>/uuid-name`) addresses the right object instead of a single `%2F`-mangled key. A
// slash-free key encodes identically to encodeURIComponent, so pre-existing flat keys are unchanged.
function keyPath(id: string): string {
  return id.split('/').map(encodeURIComponent).join('/');
}

// Low-level object put/get at a caller-chosen key — for content the console addresses by a
// deterministic path (e.g. artifact bodies at artifacts/<id>/v<n>), as opposed to saveFile's
// random-keyed uploads. Same single bucket; SeaweedFS remains the only file-storage layer.
export async function putObject(key: string, body: Buffer | string, contentType = 'application/octet-stream'): Promise<void> {
  await ensureFileSchema();
  const bytes = typeof body === 'string' ? Buffer.from(body) : body;
  const path = key.split('/').map(encodeURIComponent).join('/');
  const res = await s3Fetch(`${base}/${path}`, { method: 'PUT', headers: { 'content-type': contentType }, body: new Uint8Array(bytes) });
  if (!res.ok) throw new Error(`seaweedfs put ${res.status}`);
}
export async function getObjectText(key: string): Promise<string | null> {
  const path = key.split('/').map(encodeURIComponent).join('/');
  const res = await s3Fetch(`${base}/${path}`);
  if (!res.ok) return null;
  return res.text();
}

export async function saveFile(o: {
  name: string;
  mime: string;
  bytes: Buffer;
  visibility: string;
  owner: string;
  // TENANCY: the owning org. When set (a real tenant), the object is keyed under that org's prefix
  // (`orgs/<orgId>/…`) so listFiles can isolate it. Absent / 'default' → the bucket root (unchanged).
  orgId?: string | null;
}): Promise<FileMeta> {
  await ensureFileSchema();
  const visibility = o.visibility === 'public' ? 'public' : 'private';
  const id = `${orgFilePrefix(o.orgId)}${crypto.randomUUID()}-${safeName(o.name)}`;
  const res = await s3Fetch(`${base}/${keyPath(id)}`, {
    method: 'PUT',
    headers: {
      'content-type': o.mime || mimeFromName(o.name),
      // Metadata lives on the object — the bucket is the source of truth, not a side DB.
      'x-amz-meta-name': encodeURIComponent(o.name),
      'x-amz-meta-owner': encodeURIComponent(o.owner),
      'x-amz-meta-visibility': visibility,
    },
    body: new Uint8Array(o.bytes),
  });
  if (!res.ok) throw new Error(`seaweedfs put ${res.status}`);
  return { id, name: o.name, mime: o.mime, size: o.bytes.length, visibility, owner: o.owner, createdAt: new Date().toISOString() };
}

export async function getFileMeta(id: string): Promise<FileMeta | null> {
  const res = await s3Fetch(`${base}/${keyPath(id)}`, { method: 'HEAD' });
  if (!res.ok) return null;
  const h = res.headers;
  const metaName = h.get('x-amz-meta-name');
  return {
    id,
    name: metaName ? decodeURIComponent(metaName) : id.replace(/^[0-9a-f-]{36}-/, ''),
    mime: h.get('content-type') || mimeFromName(id),
    size: Number(h.get('content-length') || 0),
    visibility: h.get('x-amz-meta-visibility') === 'private' ? 'private' : 'public',
    owner: decodeURIComponent(h.get('x-amz-meta-owner') || ''),
    createdAt: h.get('last-modified') ? new Date(h.get('last-modified')!).toISOString() : new Date().toISOString(),
  };
}

export async function readFileBytes(id: string): Promise<Buffer | null> {
  const res = await s3Fetch(`${base}/${keyPath(id)}`);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

// List files in the media store. `owner` is accepted for signature compatibility but no longer
// filters. Cheap listing derives mime from the extension and treats objects as public (the default)
// — a per-object HEAD would be N calls.
//
// TENANCY: pass `opts.orgId` to isolate a tenant. A real org lists ONLY its prefix (`orgs/<orgId>/`)
// via the native S3 `prefix` param — so a tenant never sees another tenant's files or global
// desktop-app junk (qwythos9b frames, todo-demo), which live at the bucket root. The default /
// single-tenant org (no orgId, or 'default') lists the WHOLE bucket, unchanged (provit + erasure-
// lake callers that pass no org keep their bucket-wide view). Belt-and-braces: even under a prefix
// query we re-check each key with the pure isKeyInOrg rule so a mis-scoped result can't leak.
export async function listFiles(_owner: string, opts?: { orgId?: string | null }): Promise<FileMeta[]> {
  await ensureFileSchema();
  const orgId = opts?.orgId ?? null;
  const prefix = orgFilePrefix(orgId);
  const q = `${base}?list-type=2&max-keys=1000${prefix ? `&prefix=${encodeURIComponent(prefix)}` : ''}`;
  const res = await s3Fetch(q);
  if (!res.ok) return [];
  const xml = await res.text();
  const out: FileMeta[] = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = m[1];
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1];
    if (!key) continue;
    // Belt-and-braces: the prefix query already scopes this, but re-apply the pure org rule so a
    // stray out-of-prefix key can never leak into a tenant's list.
    if (!isKeyInOrg(key, orgId)) continue;
    const size = Number(/<Size>(\d+)<\/Size>/.exec(block)?.[1] ?? 0);
    const lm = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(block)?.[1];
    const name = (key.split('/').pop() ?? key).replace(/^[0-9a-f-]{36}-/, '');
    out.push({
      id: key,
      name,
      mime: mimeFromName(name),
      size,
      visibility: 'public',
      owner: '',
      createdAt: lm ? new Date(lm).toISOString() : new Date().toISOString(),
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Change visibility by rewriting the object's metadata in place (S3 copy-onto-self with
// REPLACE) — no byte re-upload. NOTE: the public gateway path serves the whole bucket
// read-only to the internet, so "private" is a console-side label, not a hard ACL.
export async function setVisibility(id: string, visibility: string, owner: string, isAdmin: boolean): Promise<FileMeta | null> {
  const meta = await getFileMeta(id);
  if (!meta || (!isAdmin && meta.owner && meta.owner !== owner)) return null;
  const v = visibility === 'public' ? 'public' : 'private';
  const res = await s3Fetch(`${base}/${keyPath(id)}`, {
    method: 'PUT',
    headers: {
      'x-amz-copy-source': `/${BUCKET}/${keyPath(id)}`,
      'x-amz-metadata-directive': 'REPLACE',
      'content-type': meta.mime,
      'x-amz-meta-name': encodeURIComponent(meta.name),
      'x-amz-meta-owner': encodeURIComponent(meta.owner),
      'x-amz-meta-visibility': v,
    },
  });
  if (!res.ok) return null;
  return { ...meta, visibility: v };
}

export async function deleteFile(id: string, owner: string, isAdmin: boolean): Promise<boolean> {
  const meta = await getFileMeta(id);
  if (!meta || (!isAdmin && meta.owner && meta.owner !== owner)) return false;
  const res = await s3Fetch(`${base}/${keyPath(id)}`, { method: 'DELETE' });
  return res.ok;
}

// ── Presigned share URLs ────────────────────────────────────────────────────────────────────────
// A time-limited SigV4 query-signed GET URL for one object — the URL alone grants read access for
// `ttlSeconds`, no auth header needed, then expires. The signature only VERIFIES against the S3
// endpoint that holds the keypair, so we sign against the *externally reachable* S3 endpoint
// (OFFGRID_SEAWEEDFS_PUBLIC_S3_URL, falling back to the internal S3 URL). SeaweedFS only enforces the
// signature when IAM identities are configured (broker returns kind:'s3'); with anonymous loopback S3
// there's nothing to presign against, so we DEGRADE: return the plain public gateway URL + signed:false
// so the UI can be honest rather than hand out a fake "expiring" link.

// The externally reachable SeaweedFS S3 endpoint (must be the host that validates the signature).
const PUBLIC_S3 = (process.env.OFFGRID_SEAWEEDFS_PUBLIC_S3_URL || process.env.OFFGRID_SEAWEEDFS_URL || S3).replace(/\/$/, '');

export interface ShareLink {
  url: string;
  /** true = a real SigV4-signed expiring link; false = degraded plain URL (no IAM on SeaweedFS). */
  signed: boolean;
  expiresAt: string | null;
  ttlSeconds: number;
}

/** Generate a presigned, time-limited GET URL for object `id`. `now` injectable for tests (unused in
 *  the pure signer path — that clock is injected there — but kept for a deterministic expiresAt). */
export async function presignShareUrl(id: string, ttlSeconds: number, now: Date = new Date()): Promise<ShareLink> {
  const ttl = Math.max(1, Math.min(604800, Math.floor(ttlSeconds)));
  const cred = await getServiceCredential('seaweedfs');
  const key = id.split('/').map(encodeURIComponent).join('/');
  if (cred.kind !== 's3') {
    // No IAM keypair to sign with — anonymous SeaweedFS serves the object regardless, so an "expiring"
    // link would be a lie. Hand back the honest public URL and flag it unsigned.
    return { url: publicUrlFor(id), signed: false, expiresAt: null, ttlSeconds: ttl };
  }
  const url = presignS3Url({
    url: `${PUBLIC_S3}/${BUCKET}/${key}`,
    accessKey: cred.accessKey,
    secretKey: cred.secretKey,
    expiresIn: ttl,
    date: now,
  });
  return { url, signed: true, expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(), ttlSeconds: ttl };
}

// ── Bucket lifecycle (object expiry) ──────────────────────────────────────────────────────────────
// Read/write the bucket's lifecycle configuration via the S3 lifecycle sub-resource. SeaweedFS
// implements PutBucketLifecycleConfiguration with Expiration.Days + Filter.Prefix. If the running
// SeaweedFS build doesn't support it, the call returns a non-2xx and we surface {supported:false}
// rather than pretending it worked.

export interface LifecycleState {
  supported: boolean;
  rules: LifecycleRule[];
  note?: string;
}

export async function getBucketLifecycle(): Promise<LifecycleState> {
  await ensureFileSchema();
  const res = await s3Fetch(`${base}?lifecycle=`, { method: 'GET' });
  if (res.status === 404 || res.status === 204) return { supported: true, rules: [] }; // no config yet
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // NoSuchLifecycleConfiguration is "supported, just empty"; anything else = not supported here.
    if (/NoSuchLifecycleConfiguration/i.test(body)) return { supported: true, rules: [] };
    if (res.status === 501 || res.status === 405) return { supported: false, rules: [], note: `SeaweedFS S3 returned ${res.status} for GetBucketLifecycle` };
    return { supported: false, rules: [], note: `lifecycle read failed (${res.status})` };
  }
  return { supported: true, rules: parseLifecycleXml(await res.text()) };
}

/** Replace the bucket lifecycle with `rules` (empty array clears it). Returns the resulting state. */
export async function setBucketLifecycle(rules: LifecycleRule[]): Promise<LifecycleState> {
  await ensureFileSchema();
  const xml = buildLifecycleXml(rules);
  const res = await s3Fetch(`${base}?lifecycle=`, {
    method: 'PUT',
    headers: { 'content-type': 'application/xml' },
    body: new Uint8Array(Buffer.from(xml)),
  });
  if (!res.ok) {
    if (res.status === 501 || res.status === 405) return { supported: false, rules: [], note: `SeaweedFS S3 returned ${res.status} for PutBucketLifecycle` };
    const body = await res.text().catch(() => '');
    return { supported: false, rules: [], note: `lifecycle write failed (${res.status}) ${body.slice(0, 200)}` };
  }
  return getBucketLifecycle();
}

// ── Bucket policy (public / private) ──────────────────────────────────────────────────────────────
// Read/set the bucket-level anonymous-read policy. "public" = the canonical GetObject-for-* policy;
// "private" = no policy (DeleteBucketPolicy). SeaweedFS's bucket-policy support is partial, so we
// degrade gracefully on non-2xx.

export interface BucketPolicyState {
  supported: boolean;
  access: 'public' | 'private';
  note?: string;
}

export async function getBucketPolicy(): Promise<BucketPolicyState> {
  await ensureFileSchema();
  const res = await s3Fetch(`${base}?policy=`, { method: 'GET' });
  if (res.status === 404) return { supported: true, access: 'private' }; // no policy = private
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (/NoSuchBucketPolicy/i.test(body)) return { supported: true, access: 'private' };
    if (res.status === 501 || res.status === 405) return { supported: false, access: 'private', note: `SeaweedFS S3 returned ${res.status} for GetBucketPolicy` };
    return { supported: false, access: 'private', note: `policy read failed (${res.status})` };
  }
  return { supported: true, access: classifyBucketPolicy(await res.text()) };
}

/** Set the bucket to 'public' (put anonymous-read policy) or 'private' (delete policy). */
export async function setBucketPolicy(access: 'public' | 'private'): Promise<BucketPolicyState> {
  await ensureFileSchema();
  if (access === 'private') {
    const res = await s3Fetch(`${base}?policy=`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      if (res.status === 501 || res.status === 405) return { supported: false, access: 'private', note: `SeaweedFS S3 returned ${res.status} for DeleteBucketPolicy` };
      return { supported: false, access: 'private', note: `policy delete failed (${res.status})` };
    }
    return { supported: true, access: 'private' };
  }
  const policy = buildPublicReadPolicy(BUCKET);
  const res = await s3Fetch(`${base}?policy=`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: new Uint8Array(Buffer.from(policy)),
  });
  if (!res.ok) {
    if (res.status === 501 || res.status === 405) return { supported: false, access: 'private', note: `SeaweedFS S3 returned ${res.status} for PutBucketPolicy` };
    const body = await res.text().catch(() => '');
    return { supported: false, access: 'private', note: `policy write failed (${res.status}) ${body.slice(0, 200)}` };
  }
  return { supported: true, access: 'public' };
}
