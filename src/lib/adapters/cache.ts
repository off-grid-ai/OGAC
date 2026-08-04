import { redis } from '@/lib/redis';
import { ZERO_COUNTERS, count, type CacheCounters } from '@/lib/cache-evidence';
import type { CachePort } from './types';

// Caching backends behind the CachePort — a simple KV with TTL. The exact-match layer of the
// response cache (src/lib/cache.ts) reads/writes through this, so selecting Redis makes the cache
// shared + persistent across processes; the default keeps it in-process. Redis falls back to the
// in-process map if the server is unreachable, so it's never a hard dependency.
const REDIS_URL = process.env.OFFGRID_REDIS_URL;

interface MemEntry {
  value: string;
  expires: number;
}

const mem = new Map<string, MemEntry>();
const MEM_MAX = 2000;

function memGet(key: string): string | null {
  const e = mem.get(key);
  if (!e) return null;
  if (Date.now() > e.expires) {
    mem.delete(key);
    return null;
  }
  return e.value;
}

function memSet(key: string, value: string, ttlSeconds: number): void {
  if (mem.size > MEM_MAX) {
    const oldest = mem.keys().next().value;
    if (oldest) mem.delete(oldest);
  }
  mem.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

export const memoryCache: CachePort = {
  meta: {
    id: 'memory',
    capability: 'caching',
    vendor: 'Off Grid AI in-process cache',
    license: 'first-party',
    render: 'native',
    description: 'Bounded, TTL’d in-process KV backing the exact response cache (default).',
  },
  get: (key) => Promise.resolve(memGet(key)),
  set: (key, value, ttl) => {
    memSet(key, value, ttl);
    return Promise.resolve();
  },
  health: () => Promise.resolve(true),
};

// ─── Counters ────────────────────────────────────────────────────────────────────────────────────────
// Which BACKEND answered, not just hit-versus-miss. redisCache falls back to the in-process map when Redis
// is unreachable — deliberately, Redis is never a hard dependency — and without this a deployment can
// believe it has a shared cache while every process quietly keeps its own. The judgement lives in the pure
// cache-evidence.ts; this only tallies.
let counters: CacheCounters = { ...ZERO_COUNTERS };

/** The tallies since this process started. */
export function cacheCounters(): CacheCounters {
  return { ...counters };
}

// ─── Publishing the tallies ─────────────────────────────────────────────────────────────────────────
// A process's own counters describe only the work IT did, and on this deployment the process that serves
// the cache page runs no inference while the worker runs all of it. So each process publishes a snapshot
// and the surface sums them; without this the panel reports an idle cache while the cache is working.
//
// Debounced, fire-and-forget, and never allowed to throw: this is evidence about the cache, and it must
// not become a reason the cache path fails or slows down.
let lastSnapshotAt: number | null = null;

function publish(): void {
  const now = Date.now();
  void import('@/lib/cache-evidence').then(async ({ shouldSnapshot }) => {
    if (!shouldSnapshot(lastSnapshotAt, now)) return;
    lastSnapshotAt = now; // set BEFORE awaiting, so a slow write cannot queue a second one
    const { processRole, recordCacheTally } = await import('@/lib/cache-tallies-store');
    await recordCacheTally(processRole(process.argv, process.env.OFFGRID_PROCESS_ROLE), cacheCounters());
  }).catch(() => {
    // Swallowed deliberately. If the database is unreachable the panel will show this role's snapshot as
    // stale, which is the honest outcome — far better than a cache read failing to record a statistic.
  });
}

/** Tally one event and publish if the debounce window has passed. */
function tally(field: keyof CacheCounters): void {
  counters = count(counters, field);
  publish();
}

/** Test/diagnostic reset. Never called from a request path. */
export function resetCacheCounters(): void {
  counters = { ...ZERO_COUNTERS };
  lastSnapshotAt = null;
}

export const redisCache: CachePort = {
  meta: {
    id: 'redis',
    capability: 'caching',
    vendor: 'Redis',
    license: 'BSD-3-Clause',
    render: 'headless',
    embedUrl: REDIS_URL,
    description: 'Shared exact + semantic response cache and rate limiting at scale.',
  },
  async get(key) {
    if (!REDIS_URL) {
      const local = memGet(key);
      tally(local === null ? 'misses' : 'fallbackHits');
      return local;
    }
    try {
      const shared = await redis(REDIS_URL).get(key);
      if (shared !== null) {
        tally('sharedHits');
        return shared;
      }
      // Redis answered and had nothing. The in-process map may still hold it from a write-through, and
      // serving that IS a fallback hit — the shared store did not have what it should have.
      const local = memGet(key);
      tally(local === null ? 'misses' : 'fallbackHits');
      return local;
    } catch {
      const local = memGet(key); // fall back to memory — Redis is never a hard dependency
      tally(local === null ? 'misses' : 'fallbackHits');
      return local;
    }
  },
  async set(key, value, ttl) {
    memSet(key, value, ttl); // write-through so a Redis outage still serves recent entries
    if (!REDIS_URL) {
      tally('fallbackWrites');
      return;
    }
    try {
      await redis(REDIS_URL).set(key, value, ttl);
      tally('sharedWrites');
    } catch {
      // The write survives in memory, so nothing breaks — but it did NOT reach the shared store, and
      // recording that is the whole point: a silently local write is how "shared" stops being true.
      tally('fallbackWrites');
    }
  },
  async health() {
    if (!REDIS_URL) return false;
    try {
      return (await redis(REDIS_URL).ping()) === 'PONG';
    } catch {
      return false;
    }
  },
};

export const CACHE_PORTS: CachePort[] = [memoryCache, redisCache];
