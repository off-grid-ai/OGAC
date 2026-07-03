// Marquez WRITE layer — create namespaces, tag datasets/jobs, and honestly surface what
// Marquez's REST API can and cannot do. Split into two halves:
//   • PURE request-shaping (buildNamespaceRequest, buildTagRequest, …) — zero I/O, unit-testable.
//   • Thin senders (createNamespace, tagDataset, …) — do the fetch, never throw, return {ok,error}.
//
// Marquez API capability notes (v0.x REST):
//   • PUT  /api/v1/namespaces/{ns}                                   → create/update a namespace   ✅
//   • PUT  /api/v1/tags/{name}                                        → create a tag                ✅
//   • GET  /api/v1/tags                                              → list tags                    ✅
//   • POST /api/v1/namespaces/{ns}/datasets/{ds}/tags/{tag}          → tag a dataset                ✅
//   • DELETE /api/v1/namespaces/{ns}/datasets/{ds}/tags/{tag}        → untag a dataset              ✅
//   • POST /api/v1/namespaces/{ns}/jobs/{job}/tags/{tag}            → tag a job                    ✅
//   • Deleting a namespace / dataset / job:  NOT SUPPORTED by the REST API — Marquez has no
//     destructive delete endpoint (lineage is an append-only audit graph). Callers must surface
//     this as blocked, not fake it. `MARQUEZ_CAPABILITIES.deleteEntity === false`.

const BASE = process.env.OFFGRID_MARQUEZ_URL;

export function marquezWriteConfigured(): boolean {
  return Boolean(BASE);
}

// Honest capability map — the UI reads this to enable/disable + explain each control.
export const MARQUEZ_CAPABILITIES = {
  createNamespace: true,
  createTag: true,
  tagDataset: true,
  untagDataset: true,
  tagJob: true,
  // Marquez's REST API exposes no delete for namespaces/datasets/jobs — the graph is append-only.
  deleteEntity: false,
  deleteEntityReason:
    'Marquez has no delete endpoint — its lineage graph is an append-only audit trail. ' +
    'Stale edges age out of the read window; they cannot be removed via the API.',
} as const;

// ─── PURE request-shaping ──────────────────────────────────────────────────────
export interface MarquezRequest {
  method: 'GET' | 'PUT' | 'POST' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
}

// A Marquez name must be non-empty and is URL-path-safe (Marquez itself allows ., :, /, -, _).
// We reject empty/whitespace and trim; everything else is encoded at send time.
export function normalizeName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

export interface NamespaceInput {
  name: unknown;
  ownerName?: unknown;
  description?: unknown;
}

// PUT /api/v1/namespaces/{name} — body carries ownerName (required by Marquez) + optional desc.
export function buildNamespaceRequest(input: NamespaceInput): MarquezRequest {
  const name = normalizeName(input.name);
  if (!name) throw new Error('namespace name required');
  const ownerName = normalizeName(input.ownerName) || 'offgrid-console';
  const body: Record<string, unknown> = { ownerName };
  const description = normalizeName(input.description);
  if (description) body.description = description;
  return { method: 'PUT', path: `/api/v1/namespaces/${encodeURIComponent(name)}`, body };
}

export interface TagInput {
  name: unknown;
  description?: unknown;
}

// PUT /api/v1/tags/{name} — declare a tag (with optional description) before applying it.
export function buildTagRequest(input: TagInput): MarquezRequest {
  const name = normalizeName(input.name);
  if (!name) throw new Error('tag name required');
  const description = normalizeName(input.description);
  const body = description ? { description } : {};
  return { method: 'PUT', path: `/api/v1/tags/${encodeURIComponent(name)}`, body };
}

export interface DatasetTagInput {
  namespace: unknown;
  dataset: unknown;
  tag: unknown;
}

// POST/DELETE /api/v1/namespaces/{ns}/datasets/{ds}/tags/{tag} — apply/remove a tag on a dataset.
function datasetTagPath(input: DatasetTagInput): string {
  const ns = normalizeName(input.namespace);
  const ds = normalizeName(input.dataset);
  const tag = normalizeName(input.tag);
  if (!ns || !ds || !tag) throw new Error('namespace, dataset and tag required');
  return `/api/v1/namespaces/${encodeURIComponent(ns)}/datasets/${encodeURIComponent(
    ds,
  )}/tags/${encodeURIComponent(tag)}`;
}

export function buildDatasetTagRequest(input: DatasetTagInput): MarquezRequest {
  return { method: 'POST', path: datasetTagPath(input) };
}

export function buildDatasetUntagRequest(input: DatasetTagInput): MarquezRequest {
  return { method: 'DELETE', path: datasetTagPath(input) };
}

export interface JobTagInput {
  namespace: unknown;
  job: unknown;
  tag: unknown;
}

// POST /api/v1/namespaces/{ns}/jobs/{job}/tags/{tag} — apply a tag on a job.
export function buildJobTagRequest(input: JobTagInput): MarquezRequest {
  const ns = normalizeName(input.namespace);
  const job = normalizeName(input.job);
  const tag = normalizeName(input.tag);
  if (!ns || !job || !tag) throw new Error('namespace, job and tag required');
  return {
    method: 'POST',
    path: `/api/v1/namespaces/${encodeURIComponent(ns)}/jobs/${encodeURIComponent(
      job,
    )}/tags/${encodeURIComponent(tag)}`,
  };
}

// ─── Thin senders (I/O) ──────────────────────────────────────────────────────
export interface WriteResult {
  ok: boolean;
  status?: number;
  error?: string;
}

async function send(reqShape: MarquezRequest): Promise<WriteResult> {
  if (!BASE) return { ok: false, error: 'Marquez not configured' };
  try {
    const res = await fetch(`${BASE}${reqShape.path}`, {
      method: reqShape.method,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: reqShape.body ? JSON.stringify(reqShape.body) : undefined,
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { ok: false, status: res.status, error: `Marquez ${res.status}` };
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export const createNamespace = (i: NamespaceInput): Promise<WriteResult> =>
  send(buildNamespaceRequest(i));
export const createTag = (i: TagInput): Promise<WriteResult> => send(buildTagRequest(i));
export const tagDataset = (i: DatasetTagInput): Promise<WriteResult> =>
  send(buildDatasetTagRequest(i));
export const untagDataset = (i: DatasetTagInput): Promise<WriteResult> =>
  send(buildDatasetUntagRequest(i));
export const tagJob = (i: JobTagInput): Promise<WriteResult> => send(buildJobTagRequest(i));

// List declared tags (for the tag picker). Never throws.
export async function listTags(): Promise<{ tags: string[]; error: string | null }> {
  if (!BASE) return { tags: [], error: null };
  try {
    const res = await fetch(`${BASE}/api/v1/tags`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { tags: [], error: `Marquez ${res.status}` };
    const json = (await res.json()) as { tags?: { name?: string }[] };
    const tags = (json.tags ?? [])
      .map((t) => (typeof t?.name === 'string' ? t.name : ''))
      .filter(Boolean);
    return { tags, error: null };
  } catch (e) {
    return { tags: [], error: (e as Error).message };
  }
}
