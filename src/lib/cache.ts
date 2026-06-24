import { createHash } from 'crypto';
import { getCache, getInference } from '@/lib/adapters/registry';

// Response cache — the gateway-level cost/latency win (Portkey/Bifrost-style). Two layers:
// (1) EXACT: hash of the normalized prompt, stored through the caching PORT so Redis
// (`OFFGRID_ADAPTER_CACHING=redis`) makes it shared + persistent across processes; the default
// keeps it in-process. (2) SEMANTIC: embedding cosine vs recent entries (in-process), so
// near-duplicate prompts hit too. Bounded + TTL'd so it never grows unbounded.
const MAX = 500;
const TTL_MS = 60 * 60 * 1000; // 1h
const TTL_S = TTL_MS / 1000;
const SEMANTIC_THRESHOLD = 0.92;

interface Entry {
  key: string;
  answer: string;
  vector: number[];
  ts: number;
}

const store = new Map<string, Entry>();
const stats = { hits: 0, misses: 0, exact: 0, semantic: 0 };

function hash(s: string): string {
  return createHash('sha256').update(s.trim().toLowerCase()).digest('hex');
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function fresh(e: Entry): boolean {
  return Date.now() - e.ts < TTL_MS;
}

export interface CacheHit {
  hit: boolean;
  mode?: 'exact' | 'semantic';
  answer?: string;
  score?: number;
}

// Best semantic match among fresh entries (extracted to keep cacheLookup simple).
function bestSemantic(vec: number[]): { e: Entry; score: number } | null {
  let best: { e: Entry; score: number } | null = null;
  for (const e of store.values()) {
    if (!fresh(e)) continue;
    const score = cosine(vec, e.vector);
    if (!best || score > best.score) best = { e, score };
  }
  return best;
}

export async function cacheLookup(prompt: string): Promise<CacheHit> {
  // EXACT layer — through the caching port (Redis when selected, in-process otherwise).
  const exact = await getCache().get(`resp:${hash(prompt)}`);
  if (exact !== null) {
    stats.hits += 1;
    stats.exact += 1;
    return { hit: true, mode: 'exact', answer: exact, score: 1 };
  }
  const best = bestSemantic(await getInference().embed(prompt));
  if (best && best.score >= SEMANTIC_THRESHOLD) {
    stats.hits += 1;
    stats.semantic += 1;
    return {
      hit: true,
      mode: 'semantic',
      answer: best.e.answer,
      score: Number(best.score.toFixed(3)),
    };
  }
  stats.misses += 1;
  return { hit: false };
}

export async function cacheStore(prompt: string, answer: string): Promise<void> {
  // EXACT layer through the port (persisted in Redis when selected); SEMANTIC layer in-process.
  await getCache().set(`resp:${hash(prompt)}`, answer, TTL_S);
  const vector = await getInference().embed(prompt);
  store.set(hash(prompt), { key: hash(prompt), answer, vector, ts: Date.now() });
  // Evict oldest beyond the cap.
  if (store.size > MAX) {
    const oldest = [...store.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) store.delete(oldest[0]);
  }
}

export function cacheStats() {
  const total = stats.hits + stats.misses;
  return {
    size: store.size,
    ...stats,
    hitRate: total ? Math.round((stats.hits / total) * 100) : 0,
  };
}
