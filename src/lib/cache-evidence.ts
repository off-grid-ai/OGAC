// ─── What the response cache is actually doing ──────────────────────────────────────────────────────────
//
// The capability map on the shared response cache: "Prove the deployed runtime selects Redis and expose
// hit, miss, expiry, and invalidation evidence."
//
// Proving the selection was a probe, and it passes — a value written through the adapter is readable
// straight out of Redis, so the cache is genuinely shared and not an in-process map wearing Redis's name.
//
// The evidence half did not exist, and its absence hides a specific failure. `redisCache` FALLS BACK to the
// in-process map whenever Redis is unreachable, deliberately — Redis is never a hard dependency. But that
// means a deployment can believe it has a shared cache while every process quietly keeps its own: hit rates
// look fine, `health()` is the only signal, and nothing distinguishes "Redis served this" from "Redis was
// down and memory served it". A degraded cache is not a broken one, so nothing ever complains.
//
// So the counters record WHICH BACKEND ANSWERED, not just hit-versus-miss. That is the difference between
// a cache dashboard and a cache you can trust.
//
// Pure. Zero IO.

export interface CacheCounters {
  /** Reads served from the shared store. */
  sharedHits: number;
  /** Reads served from the in-process fallback because the shared store did not answer. */
  fallbackHits: number;
  /** Reads that found nothing anywhere. */
  misses: number;
  /** Writes that reached the shared store. */
  sharedWrites: number;
  /** Writes that only reached the in-process map — the shared store refused or was unreachable. */
  fallbackWrites: number;
  /** Keys explicitly removed. */
  invalidations: number;
  /** Reads that found an entry past its TTL, counted apart from a true miss. */
  expired: number;
}

export const ZERO_COUNTERS: CacheCounters = {
  sharedHits: 0,
  fallbackHits: 0,
  misses: 0,
  sharedWrites: 0,
  fallbackWrites: 0,
  invalidations: 0,
  expired: 0,
};

export type CacheState = 'shared' | 'degraded' | 'local-only' | 'idle';

export interface CacheEvidence {
  state: CacheState;
  /** Reads that hit, over reads attempted. Null when nothing has been read. */
  hitRate: number | null;
  /** Share of served reads that came from the fallback rather than the shared store, 0..1. */
  fallbackShare: number | null;
  /** One sentence. Never reports a degraded cache as healthy. */
  sentence: string;
}

/**
 * Judge the cache from its counters.
 *
 * The state that matters is `degraded`: the cache is working — nothing is broken, requests are served — and
 * it is NOT doing the job it was configured for, because each process is answering from its own memory. A
 * hit rate alone cannot show that, which is why it is not the headline.
 */
export function cacheEvidence(c: CacheCounters, configuredShared: boolean): CacheEvidence {
  const served = c.sharedHits + c.fallbackHits;
  const reads = served + c.misses + c.expired;
  const hitRate = reads === 0 ? null : served / reads;
  const fallbackShare = served === 0 ? null : c.fallbackHits / served;
  const writes = c.sharedWrites + c.fallbackWrites;

  if (!configuredShared) {
    return {
      state: 'local-only',
      hitRate,
      fallbackShare,
      sentence:
        'The cache is in-process by configuration, so each process keeps its own copy. That is the default and it is fine for one process — it is not a shared cache.',
    };
  }

  if (reads === 0 && writes === 0) {
    // Nothing has happened. Not "healthy" — unexercised.
    return {
      state: 'idle',
      hitRate: null,
      fallbackShare: null,
      sentence: 'The shared cache is configured but nothing has been read or written through it yet, so it is unexercised rather than proven.',
    };
  }

  // Any fallback traffic at all means the shared store did not answer something it should have.
  if (c.fallbackHits > 0 || c.fallbackWrites > 0) {
    return {
      state: 'degraded',
      hitRate,
      fallbackShare,
      sentence: `The shared cache is configured but not answering everything: ${c.fallbackHits} read${c.fallbackHits === 1 ? '' : 's'} and ${c.fallbackWrites} write${c.fallbackWrites === 1 ? '' : 's'} fell back to this process's own memory. Requests are still served, so nothing looks broken — but the cache is not shared, and two processes will disagree.`,
    };
  }

  const pct = hitRate === null ? null : Math.round(hitRate * 100);
  return {
    state: 'shared',
    hitRate,
    fallbackShare,
    sentence:
      pct === null
        ? `Every write reached the shared store (${c.sharedWrites}). Nothing has been read back yet.`
        : `The shared store served every read it was asked for — ${pct}% of ${reads} reads hit${c.expired > 0 ? `, and ${c.expired} found an entry past its lifetime` : ''}.`,
  };
}

/** A counters object with one field incremented. Pure, so the store stays a plain value. */
export function count(c: CacheCounters, field: keyof CacheCounters, by = 1): CacheCounters {
  return { ...c, [field]: c[field] + by };
}
