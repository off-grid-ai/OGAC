import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ZERO_COUNTERS,
  cacheEvidence,
  count,
  type CacheCounters,
} from '../src/lib/cache-evidence.ts';

const c = (over: Partial<CacheCounters> = {}): CacheCounters => ({ ...ZERO_COUNTERS, ...over });

test('THE DEFECT THIS EXISTS FOR: a fallback-serving cache is degraded, not healthy', () => {
  // Redis unreachable, in-process map serving everything. Requests succeed, hit rate looks great, and the
  // cache is NOT shared — two processes will disagree. A hit-rate dashboard cannot show this.
  const e = cacheEvidence(c({ fallbackHits: 40, fallbackWrites: 10 }), true);
  assert.equal(e.state, 'degraded');
  assert.equal(e.hitRate, 1); // a perfect hit rate, and still degraded
  assert.equal(e.fallbackShare, 1);
  assert.match(e.sentence, /not shared/);
  assert.match(e.sentence, /two processes will disagree/);
  // It must not read as breakage either — nothing is broken.
  assert.match(e.sentence, /nothing looks broken/);
});

test('a single fallback write among many shared ones is still degraded', () => {
  // One silently-local write is how "shared" stops being true. Not averaged away.
  const e = cacheEvidence(c({ sharedHits: 500, sharedWrites: 300, fallbackWrites: 1 }), true);
  assert.equal(e.state, 'degraded');
});

test('a genuinely shared cache reports the reads it served', () => {
  const e = cacheEvidence(c({ sharedHits: 80, misses: 20, sharedWrites: 100 }), true);
  assert.equal(e.state, 'shared');
  assert.equal(e.hitRate, 0.8);
  assert.equal(e.fallbackShare, 0);
  assert.match(e.sentence, /80% of 100 reads hit/);
});

test('expired entries are counted apart from true misses and named', () => {
  const e = cacheEvidence(c({ sharedHits: 10, expired: 5, sharedWrites: 10 }), true);
  assert.equal(e.state, 'shared');
  // 10 hits out of 15 reads (10 hits + 5 expired) — an expiry is not a miss, and not a hit.
  assert.ok(Math.abs((e.hitRate ?? 0) - 10 / 15) < 1e-9);
  assert.match(e.sentence, /past its lifetime/);
});

test('a configured-but-unexercised cache is IDLE, never healthy', () => {
  const e = cacheEvidence(c(), true);
  assert.equal(e.state, 'idle');
  assert.equal(e.hitRate, null);
  assert.match(e.sentence, /unexercised rather than proven/);
});

test('an in-process cache by configuration is not reported as a failure', () => {
  const e = cacheEvidence(c({ fallbackHits: 5, fallbackWrites: 5 }), false);
  assert.equal(e.state, 'local-only');
  // The default is legitimate; it just is not a shared cache, and the copy says exactly that.
  assert.match(e.sentence, /That is the default and it is fine/);
  assert.match(e.sentence, /not a shared cache/);
});

test('hit rate is null rather than zero when nothing was read', () => {
  // Zero would read as "everything missed" — a different and alarming claim.
  const e = cacheEvidence(c({ sharedWrites: 3 }), true);
  assert.equal(e.hitRate, null);
  assert.match(e.sentence, /Nothing has been read back yet/);
});

test('count() is pure — the original tallies are untouched', () => {
  const before = c({ sharedHits: 1 });
  const after = count(before, 'sharedHits');
  assert.equal(before.sharedHits, 1);
  assert.equal(after.sharedHits, 2);
  assert.notEqual(before, after);
});

test('invalidations are tracked independently of reads', () => {
  const e = cacheEvidence(c({ sharedHits: 4, sharedWrites: 4, invalidations: 2 }), true);
  // An invalidation is neither a hit nor a miss and must not move the rate.
  assert.equal(e.hitRate, 1);
  assert.equal(e.state, 'shared');
});
