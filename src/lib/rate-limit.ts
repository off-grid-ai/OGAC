// ─── Configurable per-key / per-workspace rate limits (Portkey parity §14) — PURE core ──────────
//
// This file is the PURE, zero-I/O, zero-import decision layer. It is safe to import from the Edge
// middleware (no node:crypto, no DB). The DB-backed storage adapter lives in `rate-limit-store.ts`
// (Node-only) so the Edge bundle never pulls Postgres.
//
// `checkRateLimit` is a sliding-window counter decision identical in shape to the per-IP floor that
// already lives in src/middleware.ts; `resolveRateLimit` picks key → org → global-floor.
// Fully unit-tested in test/rate-limit.test.ts.

/** The global per-IP floor, in requests per window. Every /api/* request is subject to this. */
export const GLOBAL_RATE_LIMIT = 60;
/** The sliding window, in ms. */
export const RATE_WINDOW_MS = 60_000;

/** A single limit: `limit` requests per `windowMs`. */
export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

/** A counter entry for one bucket (one IP, or one key). */
export interface Counter {
  count: number;
  resetAt: number;
}

/** The outcome of a limit check. `retryAfterSec` is only meaningful when `allow` is false. */
export interface RateLimitResult {
  allow: boolean;
  /** Seconds until the window resets — the value for the `Retry-After` header on a 429. */
  retryAfterSec: number;
  /** Requests remaining in the current window after this call (never negative). */
  remaining: number;
}

/**
 * Pure sliding-window decision. Given a bucket `key`, its `config`, the current time and a mutable
 * `counters` map, records this request and returns allow/deny + retry-after. Same fixed-window-reset
 * behavior as the existing per-IP limiter: the first request in a window starts a fresh count that
 * resets `windowMs` later; subsequent requests increment until they exceed `limit`.
 *
 * A `limit <= 0` denies every request (retry-after = full window). This is intentional: an operator
 * setting a key's limit to 0 pauses the key at the edge.
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  now: number,
  counters: Map<string, Counter>,
): RateLimitResult {
  const windowMs = config.windowMs > 0 ? config.windowMs : RATE_WINDOW_MS;
  const limit = Math.floor(config.limit);
  const entry = counters.get(key);

  if (!entry || now > entry.resetAt) {
    const resetAt = now + windowMs;
    counters.set(key, { count: 1, resetAt });
    // A zero/negative limit denies even the first request.
    if (limit <= 0) {
      return { allow: false, retryAfterSec: Math.ceil(windowMs / 1000), remaining: 0 };
    }
    return { allow: true, retryAfterSec: 0, remaining: Math.max(0, limit - 1) };
  }

  entry.count += 1;
  const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  if (entry.count > limit) {
    return { allow: false, retryAfterSec, remaining: 0 };
  }
  return { allow: true, retryAfterSec: 0, remaining: Math.max(0, limit - entry.count) };
}

/**
 * Resolve the effective per-request limit for a call: the key's own configured limit if set, else
 * the org default if set, else the global floor. `null`/`undefined` at a level means "not set → fall
 * through". A resolved limit is always clamped to a non-negative integer.
 */
export function resolveRateLimit(
  keyLimit: number | null | undefined,
  orgDefault: number | null | undefined,
  globalFloor: number = GLOBAL_RATE_LIMIT,
  windowMs: number = RATE_WINDOW_MS,
): RateLimitConfig {
  const pick = (v: number | null | undefined): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : null;
  const limit = pick(keyLimit) ?? pick(orgDefault) ?? Math.max(0, Math.floor(globalFloor));
  return { limit, windowMs };
}
