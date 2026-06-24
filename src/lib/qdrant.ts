import { randomUUID } from 'crypto';
import { getInference } from '@/lib/adapters/registry';
import { EMBED_DIM } from '@/lib/adapters/types';
import type { BrainDoc, BrainHit } from '@/lib/brain';

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
    if (head.ok) return;
    await qfetch(`/collections/${COLLECTION}`, 'PUT', {
      vectors: { size: EMBED_DIM, distance: 'Cosine' },
    });
  })();
  return ready;
}

function embed(text: string): Promise<number[]> {
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
