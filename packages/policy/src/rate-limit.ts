// @offgrid/policy — token-bucket rate limiting, keyed by caller or model.

import type { Policy, PolicyContext } from './gateway-types.js';

export interface RateLimitOptions {
  /** Allowed requests per minute per key. */
  rpm: number;
  /** Bucket key dimension. Default: 'caller'. */
  per?: 'caller' | 'model';
}

interface Bucket {
  tokens: number;
  last: number;
}

export function rateLimit(opts: RateLimitOptions): Policy {
  const per = opts.per ?? 'caller';
  const capacity = Math.max(1, opts.rpm);
  const refillPerMs = capacity / 60_000; // tokens regained per millisecond
  const buckets = new Map<string, Bucket>();

  const keyOf = (ctx: PolicyContext): string => (per === 'model' ? ctx.model : ctx.caller);

  return {
    name: 'rate-limit',
    pre(ctx: PolicyContext): void {
      const key = keyOf(ctx);
      const now = Date.now();
      let b = buckets.get(key);
      if (!b) {
        b = { tokens: capacity, last: now };
        buckets.set(key, b);
      }
      // Refill based on elapsed time, capped at capacity.
      const elapsed = now - b.last;
      b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerMs);
      b.last = now;

      if (b.tokens < 1) {
        ctx.deny = { status: 429, message: 'rate limit exceeded', policy: 'rate-limit' };
        return;
      }
      b.tokens -= 1;
    },
  };
}
