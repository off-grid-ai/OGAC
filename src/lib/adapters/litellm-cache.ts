// ─── LiteLLM RESPONSE-CACHE adapter (I/O) — talks to the DB-backed proxy's cache API ──────────────
//
// Reads/mutates LiteLLM's response cache and hands raw JSON to the PURE litellm-cache.ts for shaping.
// All decision logic (status interpretation, flush-plan shaping, hit-rate math) lives in the pure
// module; this file only does fetch + endpoint-availability handling.
//
//   GET  /cache/ping      — cache health/status/type (may 404 when the version lacks the endpoint)
//   POST /cache/flushall  — clear the whole cache
//   POST /cache/delete    — evict specific keys
//   GET  /spend/logs      — per-request rows (READ-ONLY; we read the cache_hit marker for hit-rate)
//
// The base-URL/master-key resolution + Bearer GET are reused from litellm-http.ts (DRY). The proxy
// has no POST helper there, so the two write calls build their request here off the SAME resolver +
// env master-key (no separate config path). Every function NEVER throws into a page — unconfigured ⇒
// configured:false; unreachable/404 ⇒ honest error state.
import {
  cacheStatusUnconfigured,
  cacheStatusUnreachable,
  computeCacheStats,
  type CacheStats,
  type CacheStatus,
  type FlushPlan,
  interpretCachePing,
  normalizeCacheLogs,
  type RawCachePing,
} from '@/lib/litellm-cache';
import {
  LiteLLMHttpError,
  type Fetcher,
  litellmBaseUrl,
  litellmGet,
  litellmHttpConfigured,
} from '@/lib/litellm-http';
import { parseWindow, type SpendRange } from '@/lib/litellm-spend';

// ─── cache status ────────────────────────────────────────────────────────────────────────────────

/**
 * The live cache status — NEVER throws. Unconfigured ⇒ configured:false. /cache/ping unreachable or
 * 404 (version lacks it) ⇒ configured:true, reachable:false + honest error. A 2xx ⇒ interpreted
 * status (enabled only when a real backend + healthy signal is reported).
 */
export async function getCacheStatus(fetcher: Fetcher = fetch): Promise<CacheStatus> {
  if (!litellmHttpConfigured()) return cacheStatusUnconfigured();
  try {
    const raw = (await litellmGet('/cache/ping', fetcher, 5000)) as RawCachePing;
    return interpretCachePing(raw);
  } catch (e) {
    if (e instanceof LiteLLMHttpError) {
      const reason =
        e.status === 404
          ? 'cache API not on this LiteLLM version (404)'
          : e.message;
      return cacheStatusUnreachable(reason);
    }
    return cacheStatusUnreachable((e as Error).message);
  }
}

// ─── flush (POST) ────────────────────────────────────────────────────────────────────────────────

/** Authenticated POST against the proxy — reuses the same base URL + master key as litellm-http. */
async function litellmPost(
  path: string,
  body: unknown,
  fetcher: Fetcher,
  timeoutMs = 8000,
): Promise<unknown> {
  const base = litellmBaseUrl();
  if (!base) throw new LiteLLMHttpError(0, 'LiteLLM not configured (OFFGRID_LITELLM_URL unset)');
  const key = process.env.OFFGRID_LITELLM_MASTER_KEY;
  const res = await fetcher(`${base}${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new LiteLLMHttpError(
      res.status,
      `LiteLLM ${path} ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    );
  }
  return res.json().catch(() => ({}));
}

export interface FlushResult {
  ok: boolean;
  /** What was flushed (for the caller's response + audit). */
  kind: 'all' | 'keys';
  keysRequested?: number;
  error?: string;
}

/**
 * Execute a validated flush plan. 'all' ⇒ POST /cache/flushall; 'keys' ⇒ POST /cache/delete. Returns
 * ok:false + error on any proxy failure (unconfigured / unreachable / 404) rather than throwing, so
 * the route returns a clean 502 with the reason.
 */
export async function executeFlush(
  plan: Extract<FlushPlan, { ok: true }>,
  fetcher: Fetcher = fetch,
): Promise<FlushResult> {
  if (!litellmHttpConfigured()) {
    return { ok: false, kind: plan.kind, error: 'LiteLLM not configured (OFFGRID_LITELLM_URL unset)' };
  }
  try {
    if (plan.kind === 'all') {
      await litellmPost('/cache/flushall', undefined, fetcher);
      return { ok: true, kind: 'all' };
    }
    await litellmPost('/cache/delete', plan.body, fetcher);
    return { ok: true, kind: 'keys', keysRequested: plan.keys.length };
  } catch (e) {
    const reason =
      e instanceof LiteLLMHttpError && e.status === 404
        ? 'cache flush API not on this LiteLLM version (404)'
        : (e as Error).message;
    return { ok: false, kind: plan.kind, keysRequested: plan.kind === 'keys' ? plan.keys.length : undefined, error: reason };
  }
}

// ─── cache observability (READ /spend/logs) ───────────────────────────────────────────────────────

export interface CacheStatsResult {
  configured: boolean;
  /** The spend ledger was readable. */
  live: boolean;
  stats: CacheStats;
  error?: string;
}

const EMPTY_STATS: CacheStats = {
  requests: 0,
  decided: 0,
  hits: 0,
  misses: 0,
  hitRate: 0,
  tokensSaved: 0,
  costSaved: 0,
  markerUnavailable: true,
};

/**
 * Derive cache hit-rate + savings for a window by reading LiteLLM's own /spend/logs (READ-ONLY — the
 * same source the spend adapter uses, called directly here to avoid coupling). NEVER throws.
 * Unconfigured ⇒ configured:false. Proxy/log-read failure ⇒ live:false + honest error + empty stats.
 * A successful read ⇒ live:true + real stats (markerUnavailable flags when the deployment never
 * stamps cache_hit, so the UI won't show a fabricated hit-rate).
 */
export async function getCacheStats(
  range: SpendRange,
  fetcher: Fetcher = fetch,
  now: number = Date.now(),
): Promise<CacheStatsResult> {
  if (!litellmHttpConfigured()) {
    return { configured: false, live: false, stats: { ...EMPTY_STATS } };
  }
  const w = parseWindow(range, now);
  try {
    const raw = await litellmGet(`/spend/logs?start_date=${w.startDate}&end_date=${w.endDate}`, fetcher);
    const rows = normalizeCacheLogs(raw);
    return { configured: true, live: true, stats: computeCacheStats(rows) };
  } catch (e) {
    return { configured: true, live: false, stats: { ...EMPTY_STATS }, error: (e as Error).message };
  }
}
