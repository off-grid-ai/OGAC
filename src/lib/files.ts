// File storage service — SeaweedFS (S3) is the ONE and ONLY file-storage backend for the
// whole console: Storage, knowledge-base uploads, artifacts, everything. No local disk, no
// Postgres blob table, no parallel mechanism. Bytes AND metadata live in the `media` bucket
// (metadata as S3 object user-metadata), so the bucket is the single source of truth — a file
// uploaded straight to the bucket (e.g. via gateway.getoffgridai.co/files) shows up here too.
//
// SeaweedFS runs with `-s3` and no identity config, so its S3 API accepts anonymous requests
// on the loopback interface — no SigV4 signing needed. We speak raw S3 over fetch to stay
// dependency-free (matching the aggregator's style).

const S3 = (process.env.OFFGRID_SEAWEEDFS_URL || 'http://127.0.0.1:8333').replace(/\/$/, '');
const BUCKET = process.env.OFFGRID_SEAWEEDFS_BUCKET || 'media';
const base = `${S3}/${BUCKET}`;
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
    await fetch(base, { method: 'PUT' }).catch(() => {}); // create bucket; ignore "already exists"
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

// Low-level object put/get at a caller-chosen key — for content the console addresses by a
// deterministic path (e.g. artifact bodies at artifacts/<id>/v<n>), as opposed to saveFile's
// random-keyed uploads. Same single bucket; SeaweedFS remains the only file-storage layer.
export async function putObject(key: string, body: Buffer | string, contentType = 'application/octet-stream'): Promise<void> {
  await ensureFileSchema();
  const bytes = typeof body === 'string' ? Buffer.from(body) : body;
  const path = key.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${base}/${path}`, { method: 'PUT', headers: { 'content-type': contentType }, body: new Uint8Array(bytes) });
  if (!res.ok) throw new Error(`seaweedfs put ${res.status}`);
}
export async function getObjectText(key: string): Promise<string | null> {
  const path = key.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${base}/${path}`);
  if (!res.ok) return null;
  return res.text();
}

export async function saveFile(o: {
  name: string;
  mime: string;
  bytes: Buffer;
  visibility: string;
  owner: string;
}): Promise<FileMeta> {
  await ensureFileSchema();
  const visibility = o.visibility === 'public' ? 'public' : 'private';
  const id = `${crypto.randomUUID()}-${safeName(o.name)}`;
  const res = await fetch(`${base}/${encodeURIComponent(id)}`, {
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
  const res = await fetch(`${base}/${encodeURIComponent(id)}`, { method: 'HEAD' });
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
  const res = await fetch(`${base}/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

// List the WHOLE bucket (shared media store) — files uploaded via the UI and files pushed
// straight to the bucket both appear. `owner` is accepted for signature compatibility but no
// longer filters: the store is a single shared namespace. Cheap listing derives mime from the
// extension and treats objects as public (the default) — a per-object HEAD would be N calls.
export async function listFiles(_owner: string): Promise<FileMeta[]> {
  await ensureFileSchema();
  const res = await fetch(`${base}?list-type=2&max-keys=1000`);
  if (!res.ok) return [];
  const xml = await res.text();
  const out: FileMeta[] = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = m[1];
    const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
    if (!key) continue;
    const size = Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0);
    const lm = block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1];
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
  const res = await fetch(`${base}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      'x-amz-copy-source': `/${BUCKET}/${encodeURIComponent(id)}`,
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
  const res = await fetch(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return res.ok;
}
