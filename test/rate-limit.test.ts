import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  checkRateLimit,
  resolveRateLimit,
  GLOBAL_RATE_LIMIT,
  RATE_WINDOW_MS,
  type Counter,
} from '../src/lib/rate-limit.ts';

// Pure functions, real inputs, no mocks — this is the exact decision the middleware runs at the edge.

function freshMap(): Map<string, Counter> {
  return new Map<string, Counter>();
}

test('checkRateLimit: allows up to the limit, then denies within the window', () => {
  const counters = freshMap();
  const cfg = { limit: 3, windowMs: 60_000 };
  const now = 1_000;
  // 3 requests allowed…
  for (let i = 0; i < 3; i++) {
    const r = checkRateLimit('k', cfg, now, counters);
    assert.equal(r.allow, true, `request ${i + 1} should be allowed`);
  }
  // …the 4th (over limit) is denied.
  const denied = checkRateLimit('k', cfg, now, counters);
  assert.equal(denied.allow, false);
  assert.ok(denied.retryAfterSec >= 1, 'a denied request reports a positive retry-after');
});

test('checkRateLimit: remaining decrements and never goes negative', () => {
  const counters = freshMap();
  const cfg = { limit: 2, windowMs: 60_000 };
  assert.equal(checkRateLimit('k', cfg, 0, counters).remaining, 1);
  assert.equal(checkRateLimit('k', cfg, 0, counters).remaining, 0);
  assert.equal(checkRateLimit('k', cfg, 0, counters).remaining, 0);
});

test('checkRateLimit: window reset re-admits after the window elapses', () => {
  const counters = freshMap();
  const cfg = { limit: 1, windowMs: 60_000 };
  assert.equal(checkRateLimit('k', cfg, 0, counters).allow, true);
  assert.equal(checkRateLimit('k', cfg, 100, counters).allow, false); // still in window
  // Past the reset boundary → a fresh window, allowed again.
  assert.equal(checkRateLimit('k', cfg, 60_001, counters).allow, true);
});

test('checkRateLimit: retry-after counts down toward the reset', () => {
  const counters = freshMap();
  const cfg = { limit: 1, windowMs: 60_000 };
  checkRateLimit('k', cfg, 0, counters); // opens the window, resetAt=60_000
  const early = checkRateLimit('k', cfg, 1_000, counters);
  const late = checkRateLimit('k', cfg, 59_000, counters);
  assert.equal(early.allow, false);
  assert.equal(late.allow, false);
  assert.ok(early.retryAfterSec > late.retryAfterSec, 'retry-after shrinks as the reset nears');
  assert.ok(late.retryAfterSec >= 1, 'never reports 0 seconds while still denied');
});

test('checkRateLimit: a zero limit denies even the first request', () => {
  const counters = freshMap();
  const r = checkRateLimit('k', { limit: 0, windowMs: 60_000 }, 0, counters);
  assert.equal(r.allow, false);
  assert.equal(r.retryAfterSec, 60);
});

test('checkRateLimit: separate keys have independent counters', () => {
  const counters = freshMap();
  const cfg = { limit: 1, windowMs: 60_000 };
  assert.equal(checkRateLimit('a', cfg, 0, counters).allow, true);
  assert.equal(checkRateLimit('a', cfg, 0, counters).allow, false);
  // A different key is unaffected.
  assert.equal(checkRateLimit('b', cfg, 0, counters).allow, true);
});

test('resolveRateLimit: per-key limit wins when set', () => {
  const cfg = resolveRateLimit(10, 100, 60);
  assert.equal(cfg.limit, 10);
  assert.equal(cfg.windowMs, RATE_WINDOW_MS);
});

test('resolveRateLimit: falls back to org default when the key limit is unset', () => {
  assert.equal(resolveRateLimit(null, 100, 60).limit, 100);
  assert.equal(resolveRateLimit(undefined, 100, 60).limit, 100);
});

test('resolveRateLimit: falls back to the global floor when neither is set', () => {
  assert.equal(resolveRateLimit(null, null, 60).limit, 60);
  assert.equal(resolveRateLimit(undefined, undefined).limit, GLOBAL_RATE_LIMIT);
});

test('resolveRateLimit: a zero key limit is honored (not treated as unset)', () => {
  // 0 is a real value — pause the key — and must NOT fall through to the org/global default.
  assert.equal(resolveRateLimit(0, 100, 60).limit, 0);
});

test('resolveRateLimit: negative / non-finite values are clamped to a safe integer', () => {
  assert.equal(resolveRateLimit(-5, null, 60).limit, 0);
  assert.equal(resolveRateLimit(Number.NaN, 100, 60).limit, 100); // NaN → unset → org default
  assert.equal(resolveRateLimit(3.9, null, 60).limit, 3); // floored
});

test('integration: per-key limit enforced as allow-then-429 (the done-bar behavior)', () => {
  // An operator set this key to 2 req/min. The middleware resolves + enforces it: 2 pass, 3rd 429s.
  const counters = freshMap();
  const cfg = resolveRateLimit(2, null, GLOBAL_RATE_LIMIT);
  const hash = 'key:deadbeef';
  assert.equal(checkRateLimit(hash, cfg, 0, counters).allow, true);
  assert.equal(checkRateLimit(hash, cfg, 0, counters).allow, true);
  const third = checkRateLimit(hash, cfg, 0, counters);
  assert.equal(third.allow, false, 'the configured per-key limit produces a 429 on the 3rd call');
  assert.ok(third.retryAfterSec >= 1);
});

test('integration: an unset key uses the global floor, not a stricter limit', () => {
  const counters = freshMap();
  const cfg = resolveRateLimit(null, null, GLOBAL_RATE_LIMIT);
  // The floor is 60/min — the 60th call is still allowed.
  let last = { allow: true } as { allow: boolean };
  for (let i = 0; i < GLOBAL_RATE_LIMIT; i++) last = checkRateLimit('k', cfg, 0, counters);
  assert.equal(last.allow, true, `call #${GLOBAL_RATE_LIMIT} within the floor is allowed`);
  assert.equal(checkRateLimit('k', cfg, 0, counters).allow, false, 'the 61st call is denied');
});
