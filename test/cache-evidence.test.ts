import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TALLY_STALE_MS,
  ZERO_COUNTERS,
  aggregateTallies,
  cacheEvidence,
  cacheSelection,
  count,
  shouldSnapshot,
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

test('THE AMBIGUITY: a shared cache with no address produces the SAME counters as an outage', () => {
  // Both cases tally every write to the fallback. cacheEvidence cannot tell them apart and must not try —
  // so the selection is what names the cause, and the remedies are genuinely different: start the server,
  // versus configure an address for a server nobody has named.
  const outageLike = c({ fallbackWrites: 12, fallbackHits: 3 });
  const evidence = cacheEvidence(outageLike, true);
  assert.equal(evidence.state, 'degraded');

  const unreachable = cacheSelection('redis', true);
  const unnamed = cacheSelection('redis', false);
  assert.equal(unreachable.misconfigured, false);
  assert.equal(unnamed.misconfigured, true);
  assert.match(unnamed.sentence, /missing setting, not an outage/);
  // The outage case must NOT be described as a missing setting.
  assert.doesNotMatch(unreachable.sentence, /missing setting/);
});

test('the in-process default is not a misconfiguration, with or without an address', () => {
  for (const hasAddress of [true, false]) {
    const s = cacheSelection('memory', hasAddress);
    assert.equal(s.configuredShared, false);
    assert.equal(s.misconfigured, false);
    // A leftover address while in-process is selected is not an error — the address is simply unused.
    assert.doesNotMatch(s.sentence, /outage|missing/);
  }
});

test('an unknown cache port is treated as not-shared rather than assumed shared', () => {
  // Assuming shared would claim a guarantee the port may not provide.
  const s = cacheSelection('some-future-cache', true);
  assert.equal(s.configuredShared, false);
  assert.equal(s.misconfigured, false);
});

const NOW = 1_770_000_000_000;

test('THE DEFECT THIS EXISTS FOR: the process serving the page is not the one running the work', () => {
  // Measured live: the console process reports all zeroes while the worker does every inference. Reading
  // one process therefore reports UNEXERCISED about a cache that is working — accurate numbers, false story.
  const web = { label: 'web', counters: c(), reportedAt: NOW };
  const worker = { label: 'worker', counters: c({ sharedHits: 60, misses: 12, sharedWrites: 12 }), reportedAt: NOW };

  const webOnly = cacheEvidence(web.counters, true);
  assert.equal(webOnly.state, 'idle'); // what the surface used to say

  const agg = aggregateTallies([web, worker], NOW);
  assert.equal(agg.total.sharedHits, 60);
  assert.equal(agg.total.misses, 12);
  assert.equal(cacheEvidence(agg.total, true).state, 'shared'); // what is actually true
});

test('one process falling back is degraded even when another looks perfect', () => {
  // Averaging would bury this: the worker is silently local while the web process is fine.
  const agg = aggregateTallies(
    [
      { label: 'web', counters: c({ sharedHits: 900, sharedWrites: 400 }), reportedAt: NOW },
      { label: 'worker', counters: c({ fallbackWrites: 3 }), reportedAt: NOW },
    ],
    NOW,
  );
  assert.equal(agg.total.fallbackWrites, 3);
  assert.equal(cacheEvidence(agg.total, true).state, 'degraded');
});

test('a stale snapshot is still counted but MARKED, never presented as current', () => {
  const agg = aggregateTallies(
    [
      { label: 'worker', counters: c({ sharedHits: 5, sharedWrites: 5 }), reportedAt: NOW - TALLY_STALE_MS - 1 },
      { label: 'web', counters: c({ sharedHits: 1, sharedWrites: 1 }), reportedAt: NOW },
    ],
    NOW,
  );
  // The reads really happened, so they count.
  assert.equal(agg.total.sharedHits, 6);
  // Freshest first, and only the old one is flagged.
  assert.deepEqual(agg.processes.map((p) => [p.label, p.stale]), [['web', false], ['worker', true]]);
  assert.equal(agg.allStale, false);
});

test('every process stale means the totals are history, and it says so', () => {
  const agg = aggregateTallies(
    [{ label: 'worker', counters: c({ sharedHits: 9, sharedWrites: 9 }), reportedAt: NOW - TALLY_STALE_MS - 1 }],
    NOW,
  );
  assert.equal(agg.allStale, true);
});

test('no reporting processes is not "all stale" — there is nothing to be stale', () => {
  const agg = aggregateTallies([], NOW);
  assert.equal(agg.allStale, false);
  assert.deepEqual(agg.total, ZERO_COUNTERS);
  // And with nothing reported the cache reads as unexercised, not broken.
  assert.equal(cacheEvidence(agg.total, true).state, 'idle');
});

test('a clock skewed snapshot from the future is age zero, not negative', () => {
  const agg = aggregateTallies([{ label: 'w', counters: c(), reportedAt: NOW + 60_000 }], NOW);
  assert.equal(agg.processes[0].ageMs, 0);
  assert.equal(agg.processes[0].stale, false);
});

test('a row missing a counter field contributes zero rather than NaN', () => {
  // Rows come back from JSON, and one NaN would poison every total on the panel.
  const partial = { sharedHits: 4 } as unknown as CacheCounters;
  const agg = aggregateTallies([{ label: 'old-version', counters: partial, reportedAt: NOW }], NOW);
  assert.equal(agg.total.sharedHits, 4);
  assert.equal(agg.total.misses, 0);
  for (const v of Object.values(agg.total)) assert.ok(Number.isFinite(v));
});

test('snapshots are debounced, and the first one always writes', () => {
  assert.equal(shouldSnapshot(null, NOW), true);
  assert.equal(shouldSnapshot(NOW, NOW + 1), false);
  assert.equal(shouldSnapshot(NOW, NOW + 15_000), true);
  // Explicit window honoured, so a caller can tighten it without editing the default.
  assert.equal(shouldSnapshot(NOW, NOW + 100, 50), true);
});

test('invalidations are tracked independently of reads', () => {
  const e = cacheEvidence(c({ sharedHits: 4, sharedWrites: 4, invalidations: 2 }), true);
  // An invalidation is neither a hit nor a miss and must not move the rate.
  assert.equal(e.hitRate, 1);
  assert.equal(e.state, 'shared');
});
