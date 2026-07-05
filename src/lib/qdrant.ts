import { randomUUID } from 'crypto';
import { EMBED_DIM } from '@/lib/adapters/types';
import type { BrainDoc, BrainHit } from '@/lib/brain';

// Qdrant retrieval backend — the server-scale swap-in for the Brain's vector store, selected via
// OFFGRID_ADAPTER_RETRIEVAL=qdrant. Same BrainDoc/BrainHit contract as the LanceDB default, reached
// purely over Qdrant's REST API (no client dependency). Embeddings still go through the inference
// port, so the model endpoint is unchanged. The collection is created lazily on first use.
const QDRANT_URL = process.env.OFFGRID_QDRANT_URL ?? 'http://offgrid-s1.local:6333';
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
    if (head.ok) return;
    await qfetch(`/collections/${COLLECTION}`, 'PUT', {
      vectors: { size: EMBED_DIM, distance: 'Cosine' },
    });
  })();
  return ready;
}

// Lazy registry import to break the brain/qdrant ← registry ← adapters/evals ← brain cycle — see
// the same note in brain.ts. A top-level import trips a TDZ on Node 22 during the build.
async function embed(text: string): Promise<number[]> {
  const { getInference } = await import('@/lib/adapters/registry');
  return getInference().embed(text);
}

export async function qdrantAdd(title: string, source: string, text: string): Promise<BrainDoc> {
  await ensureCollection();
  const id = randomUUID();
  const vector = await embed(`${title}\n${text}`);
  await qfetch(`/collections/${COLLECTION}/points`, 'PUT', {
    points: [{ id, vector, payload: { title, source, text } }],
  });
  return { id, title, source, text };
}

export async function qdrantDelete(id: string): Promise<void> {
  await ensureCollection();
  await qfetch(`/collections/${COLLECTION}/points/delete`, 'POST', { points: [id] });
}

// Bulk reindex — push a set of already-materialized Brain docs into the Qdrant collection so that
// switching OFFGRID_ADAPTER_RETRIEVAL=qdrant lands on a populated store instead of an empty one.
// Docs are passed in (not imported from brain.ts) to avoid an import cycle: brain.ts imports this.
// Embeddings are recomputed through the inference port; the doc id is preserved so re-runs upsert
// rather than duplicate. Returns the number of points written.
export async function qdrantReindex(
  docs: ReadonlyArray<{ id: string; title: string; source: string; text: string }>,
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
        payload: { title: d.title, source: d.source, text: d.text },
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
  payload: { title: string; source: string; text: string };
}

export async function qdrantList(): Promise<BrainDoc[]> {
  await ensureCollection();
  const res = await qfetch(`/collections/${COLLECTION}/points/scroll`, 'POST', {
    limit: 1000,
    with_payload: true,
  });
  const data = (await res.json()) as { result?: { points?: ScrollPoint[] } };
  return (data.result?.points ?? []).map((p) => ({
    id: String(p.id),
    title: p.payload.title,
    source: p.payload.source,
    text: p.payload.text,
  }));
}

interface SearchPoint extends ScrollPoint {
  score: number;
}

export async function qdrantSearch(query: string, k = 5): Promise<BrainHit[]> {
  await ensureCollection();
  const vector = await embed(query);
  const res = await qfetch(`/collections/${COLLECTION}/points/search`, 'POST', {
    vector,
    limit: k,
    with_payload: true,
  });
  const data = (await res.json()) as { result?: SearchPoint[] };
  return (data.result ?? []).map((p) => ({
    id: String(p.id),
    title: p.payload.title,
    source: p.payload.source,
    text: p.payload.text,
    score: Number(p.score.toFixed(3)),
  }));
}

export async function qdrantHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${QDRANT_URL}/healthz`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}
