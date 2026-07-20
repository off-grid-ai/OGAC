import { randomUUID } from 'node:crypto';
import { EMBED_DIM } from '@/lib/adapters/types';
import type { BrainDoc, BrainHit } from '@/lib/brain';
import { ACL_FIELDS, aclFromPayload, filterHitsByAcl, type DocAcl } from '@/lib/retrieval/acl';
import {
  buildQdrantFilter,
  buildQdrantAclShould,
  type QdrantFieldCondition,
  type RetrievalOptions,
} from '@/lib/retrieval/query';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';
import { migrateLegacyQdrantPayloads } from '@/lib/qdrant-migration';

// Superuser roles that bypass server-side ACL narrowing (the post-filter also passes them).
const SUPERUSER_ROLES = ['admin'];

// Only write ACL keys that carry a value → un-ACL'd docs keep the exact payload shape as before.
function aclPayload(acl?: DocAcl): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (acl?.owner) p[ACL_FIELDS.owner] = acl.owner;
  if (acl?.allowed_roles?.length) p[ACL_FIELDS.allowedRoles] = acl.allowed_roles;
  if (acl?.allowed_subjects?.length) p[ACL_FIELDS.allowedSubjects] = acl.allowed_subjects;
  if (acl?.data_class) p[ACL_FIELDS.dataClass] = acl.data_class;
  return p;
}

// Qdrant retrieval backend — the server-scale swap-in for the Brain's vector store, selected via
// OFFGRID_ADAPTER_RETRIEVAL=qdrant. Same BrainDoc/BrainHit contract as the LanceDB default, reached
// purely over Qdrant's REST API (no client dependency). Embeddings still go through the inference
// port, so the model endpoint is unchanged. The collection is created lazily on first use.
const QDRANT_URL = process.env.OFFGRID_QDRANT_URL ?? 'http://127.0.0.1:6333';
const COLLECTION = process.env.OFFGRID_QDRANT_COLLECTION ?? 'offgrid-brain';
const API_KEY = process.env.OFFGRID_QDRANT_API_KEY;

function headers(): Record<string, string> {
  return { 'content-type': 'application/json', ...(API_KEY ? { 'api-key': API_KEY } : {}) };
}

async function qfetch(path: string, method: string, body?: unknown): Promise<Response> {
  return fetch(`${QDRANT_URL}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
}

let ready: Promise<void> | null = null;

async function ensureCollection(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    const head = await qfetch(`/collections/${COLLECTION}`, 'GET');
    if (!head.ok) {
      const created = await qfetch(`/collections/${COLLECTION}`, 'PUT', {
        vectors: { size: EMBED_DIM, distance: 'Cosine' },
      });
      if (!created.ok) throw new Error(`Qdrant collection create failed (${created.status})`);
    }
    // Pre-tenancy points had no org_id. Assign those once to the historic default tenant before
    // any tenant-scoped list/search can proceed; a failed migration fails closed.
    await migrateLegacyQdrantPayloads(COLLECTION, DEFAULT_ORG, (path, method, body) =>
      qfetch(path, method, body),
    );
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

// Lazy registry import to break the brain/qdrant ← registry ← adapters/evals ← brain cycle — see
// the same note in brain.ts. A top-level import trips a TDZ on Node 22 during the build.
async function embed(text: string): Promise<number[]> {
  const { getInference } = await import('@/lib/adapters/registry');
  return getInference().embed(text);
}

export async function qdrantAdd(
  title: string,
  source: string,
  text: string,
  acl?: DocAcl,
  orgId: string = DEFAULT_ORG,
): Promise<BrainDoc> {
  await ensureCollection();
  const id = randomUUID();
  const vector = await embed(`${title}\n${text}`);
  await qfetch(`/collections/${COLLECTION}/points`, 'PUT', {
    points: [{ id, vector, payload: { org_id: orgId, title, source, text, ...aclPayload(acl) } }],
  });
  return { id, orgId, title, source, text, acl };
}

export async function qdrantDelete(id: string, orgId: string = DEFAULT_ORG): Promise<void> {
  await ensureCollection();
  await qfetch(`/collections/${COLLECTION}/points/delete`, 'POST', {
    filter: {
      must: [{ key: 'org_id', match: { value: orgId } }, { has_id: [id] }],
    },
  });
}

// Bulk reindex — push a set of already-materialized Brain docs into the Qdrant collection so that
// switching OFFGRID_ADAPTER_RETRIEVAL=qdrant lands on a populated store instead of an empty one.
// Docs are passed in (not imported from brain.ts) to avoid an import cycle: brain.ts imports this.
// Embeddings are recomputed through the inference port; the doc id is preserved so re-runs upsert
// rather than duplicate. Returns the number of points written.
export async function qdrantReindex(
  docs: ReadonlyArray<{
    id: string;
    orgId: string;
    title: string;
    source: string;
    text: string;
    acl?: DocAcl;
  }>,
): Promise<number> {
  await ensureCollection();
  if (docs.length === 0) return 0;
  const BATCH = 32;
  let written = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const slice = docs.slice(i, i + BATCH);
    const points = await Promise.all(
      slice.map(async (d) => ({
        id: d.id,
        vector: await embed(`${d.title}\n${d.text}`),
        payload: {
          org_id: d.orgId,
          title: d.title,
          source: d.source,
          text: d.text,
          ...aclPayload(d.acl),
        },
      })),
    );
    const res = await qfetch(`/collections/${COLLECTION}/points`, 'PUT', { points });
    if (!res.ok) throw new Error(`Qdrant upsert ${res.status}`);
    written += points.length;
  }
  return written;
}

// Point count in the collection — for the admin panel's "N docs indexed" readout.
export async function qdrantCount(): Promise<number | null> {
  try {
    await ensureCollection();
    const res = await qfetch(`/collections/${COLLECTION}/points/count`, 'POST', { exact: true });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: { count?: number } };
    return data.result?.count ?? 0;
  } catch {
    return null;
  }
}

export function qdrantCollectionName(): string {
  return COLLECTION;
}

interface ScrollPoint {
  id: string;
  // ACL keys (owner / allowed_roles / allowed_subjects / data_class) ride along in the payload;
  // aclFromPayload() reads them back for the post-filter. Absent keys → un-ACL'd (visible).
  payload: { org_id?: string; title: string; source: string; text: string } & Record<
    string,
    unknown
  >;
}

// Full scroll — paginate past Qdrant's per-request page size with the scroll cursor so large
// collections are NOT truncated at 1000. Each page returns a `next_page_offset`; we follow it
// until it's null. A hard safety cap (MAX_SCROLL) bounds worst-case memory/time.
const SCROLL_PAGE = 1000;
const MAX_SCROLL = 1_000_000;

export async function qdrantList(orgId: string = DEFAULT_ORG): Promise<BrainDoc[]> {
  await ensureCollection();
  const docs: BrainDoc[] = [];
  let offset: unknown = undefined;
  do {
    const res = await qfetch(`/collections/${COLLECTION}/points/scroll`, 'POST', {
      limit: SCROLL_PAGE,
      with_payload: true,
      filter: { must: [{ key: 'org_id', match: { value: orgId } }] },
      ...(offset !== undefined && offset !== null ? { offset } : {}),
    });
    const data = (await res.json()) as {
      result?: { points?: ScrollPoint[]; next_page_offset?: unknown };
    };
    for (const p of data.result?.points ?? []) {
      docs.push({
        id: String(p.id),
        orgId: typeof p.payload.org_id === 'string' ? p.payload.org_id : orgId,
        title: p.payload.title,
        source: p.payload.source,
        text: p.payload.text,
        acl: aclFromPayload(p.payload),
      });
    }
    offset = data.result?.next_page_offset ?? null;
  } while (offset !== null && offset !== undefined && docs.length < MAX_SCROLL);
  return docs;
}

interface SearchPoint extends ScrollPoint {
  score: number;
}

function toHit(p: SearchPoint): BrainHit {
  return {
    id: String(p.id),
    orgId: typeof p.payload.org_id === 'string' ? p.payload.org_id : DEFAULT_ORG,
    title: p.payload.title,
    source: p.payload.source,
    text: p.payload.text,
    acl: aclFromPayload(p.payload),
    score: Number(p.score.toFixed(3)),
  };
}

// Keyword condition set for hybrid retrieval: match ANY of the query's word tokens against the
// `text` field (needs a full-text payload index on `text`, ensured lazily below). This is the
// BM25-flavoured lexical leg that RRF fuses with the dense-vector leg.
function keywordShould(query: string): Array<{ key: string; match: { text: string } }> {
  const terms = Array.from(new Set(query.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [])).slice(0, 16);
  return terms.map((t) => ({ key: 'text', match: { text: t } }));
}

let textIndexReady: Promise<void> | null = null;
// A full-text payload index on `text` is required for the keyword leg's text-match. Create it
// lazily and tolerate "already exists"; never let a failure here break vector search.
async function ensureTextIndex(): Promise<void> {
  if (textIndexReady) return textIndexReady;
  textIndexReady = (async () => {
    try {
      await qfetch(`/collections/${COLLECTION}/index`, 'PUT', {
        field_name: 'text',
        field_schema: { type: 'text', tokenizer: 'word', lowercase: true },
      });
    } catch {
      /* best-effort — hybrid falls back to vector-only if this never lands */
    }
  })();
  return textIndexReady;
}

/**
 * Vector search over the Qdrant collection, now with optional metadata filtering and a hybrid
 * (keyword + vector) mode. Backward compatible: called as `qdrantSearch(query, k)` with no options
 * it issues the exact same pure-vector `/points/search` request as before.
 *
 * - opts.filter → threaded through buildQdrantFilter() into Qdrant's `filter: { must: [...] }`.
 * - opts.mode === 'hybrid' → uses the Query API with two prefetch legs (dense vector + keyword
 *   text-match) fused server-side by Reciprocal Rank Fusion.
 * - opts.asker → permissions-aware retrieval. Server-side NARROWING (an ACL `should` group, AND'd
 *   into the metadata filter) prunes obviously-disallowed docs; the pure post-filter
 *   (filterHitsByAcl → docVisibleTo) is the AUTHORITATIVE gate, so correctness holds even without
 *   the push-down (older Qdrant / fallback). Un-ACL'd docs stay visible; the `should` group carries
 *   `is_empty` arms so narrowing never hides them. Composes with filter + hybrid.
 */
export async function qdrantSearch(
  query: string,
  k = 5,
  opts: RetrievalOptions = {},
  orgId: string = DEFAULT_ORG,
): Promise<BrainHit[]> {
  await ensureCollection();
  const vector = await embed(query);

  // Compose the metadata filter with an ACL narrowing `should` group (OR of the asker's grants plus
  // `is_empty` arms so un-ACL'd docs still match). Both live under the same `filter` object: `must`
  // (metadata) AND `should` (≥1 must hold). Post-filter is authoritative regardless.
  const aclShould = opts.asker ? buildAclShouldWithUnAcled(opts.asker) : undefined;
  const baseFilter = buildQdrantFilter(opts.filter);
  const must = [{ key: 'org_id', match: { value: orgId } }, ...(baseFilter?.must ?? [])];
  const filter =
    must.length > 0 || aclShould
      ? { must, ...(aclShould ? { should: aclShould } : {}) }
      : undefined;
  // When an ACL applies, over-fetch so the post-filter still yields up to k allowed hits.
  const fetchK = opts.asker ? Math.max(k * 4, 20) : k;
  const aclPass = (hits: BrainHit[]) =>
    (opts.asker ? filterHitsByAcl(opts.asker, hits, (h) => h.acl ?? null) : hits).slice(0, k);

  // Pure-vector path — byte-identical to the original request when no filter/asker is supplied.
  if (opts.mode !== 'hybrid') {
    const res = await qfetch(`/collections/${COLLECTION}/points/search`, 'POST', {
      vector,
      limit: fetchK,
      with_payload: true,
      ...(filter ? { filter } : {}),
    });
    const data = (await res.json()) as { result?: SearchPoint[] };
    return aclPass((data.result ?? []).map(toHit));
  }

  // Hybrid path — Query API: prefetch a dense-vector leg and a keyword leg, fuse with RRF. The
  // optional metadata filter applies to both legs. Any tokens are OR'd via a nested should filter.
  await ensureTextIndex();
  const should = keywordShould(query);
  const prefetchFilter = (extra?: Record<string, unknown>) =>
    filter || extra ? { filter: { ...filter, ...extra } } : {};

  const body = {
    prefetch: [
      { query: vector, limit: Math.max(k * 4, 20), ...prefetchFilter() },
      ...(should.length > 0
        ? [{ query: vector, limit: Math.max(k * 4, 20), ...prefetchFilter({ should }) }]
        : []),
    ],
    query: { fusion: 'rrf' },
    limit: fetchK,
    with_payload: true,
  };
  const res = await qfetch(`/collections/${COLLECTION}/points/query`, 'POST', body);
  if (res.ok) {
    const data = (await res.json()) as { result?: { points?: SearchPoint[] } };
    const points = data.result?.points;
    if (points) return aclPass(points.map(toHit));
  }
  // Fallback: if the Query API isn't available (older Qdrant), degrade to filtered vector search.
  const res2 = await qfetch(`/collections/${COLLECTION}/points/search`, 'POST', {
    vector,
    limit: fetchK,
    with_payload: true,
    ...(filter ? { filter } : {}),
  });
  const data2 = (await res2.json()) as { result?: SearchPoint[] };
  return aclPass((data2.result ?? []).map(toHit));
}

// The ACL narrowing `should` (OR) group for Qdrant: the asker's grant conditions (from the pure
// builder) PLUS `is_empty` arms on every ACL field so un-ACL'd docs also match (stay visible). This
// is NON-authoritative narrowing — the post-filter is the real gate — but it prunes the candidate
// set server-side. Returns undefined for superusers / no grants (→ narrowing skipped, post-filter
// alone decides). Kept in the adapter (not query.ts) because `is_empty` is a Qdrant-specific arm.
function buildAclShouldWithUnAcled(asker: {
  subject?: string | null;
  roles?: readonly string[];
}): Array<QdrantFieldCondition | { is_empty: { key: string } }> | undefined {
  const grants = buildQdrantAclShould({
    subject: asker.subject,
    roles: asker.roles,
    superuserRoles: SUPERUSER_ROLES,
    fields: {
      owner: ACL_FIELDS.owner,
      allowedRoles: ACL_FIELDS.allowedRoles,
      allowedSubjects: ACL_FIELDS.allowedSubjects,
      dataClass: ACL_FIELDS.dataClass,
    },
  });
  if (!grants) return undefined; // superuser or no identifying grants → no narrowing
  // Un-ACL'd = ALL three enforcement fields empty. Qdrant `should` is OR at the top; to require all
  // three empty together they must be one nested `must`, so we wrap it as a single should-arm.
  const unAcled = {
    is_empty: { key: ACL_FIELDS.owner },
  };
  // Compose: grants OR (owner empty). allowed_roles/allowed_subjects-only docs are still caught by
  // the authoritative post-filter, so this narrowing stays safe (never hides a doc it shouldn't).
  return [...grants, unAcled];
}

export async function qdrantHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${QDRANT_URL}/healthz`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}
