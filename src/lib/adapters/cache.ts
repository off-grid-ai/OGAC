import { redis } from '@/lib/redis';
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
    vendor: 'Off Grid in-process cache',
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
    if (!REDIS_URL) return memGet(key);
    try {
      return await redis(REDIS_URL).get(key);
    } catch {
      return memGet(key); // fall back to memory — Redis is never a hard dependency
    }
  },
  async set(key, value, ttl) {
    memSet(key, value, ttl); // write-through so a Redis outage still serves recent entries
    if (!REDIS_URL) return;
    try {
      await redis(REDIS_URL).set(key, value, ttl);
    } catch {
      /* best-effort */
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
