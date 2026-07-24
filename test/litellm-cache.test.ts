import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cacheStatusUnconfigured,
  cacheStatusUnreachable,
  computeCacheStats,
  flushAuditResource,
  interpretCachePing,
  normalizeCacheLogs,
  normalizeCachePolicy,
  normalizeCacheType,
  planFlush,
  readCacheHit,
  type RawCacheLog,
  type RawCachePing,
} from '../src/lib/litellm-cache.ts';

// ─── normalizeCacheType ───────────────────────────────────────────────────────────────────────
test('normalizeCacheType: known backends pass, garbage → unknown', () => {
  assert.equal(normalizeCacheType('redis'), 'redis');
  assert.equal(normalizeCacheType('REDIS'), 'redis');
  assert.equal(normalizeCacheType(' local '), 'local');
  assert.equal(normalizeCacheType('s3'), 's3');
  assert.equal(normalizeCacheType('redis-semantic'), 'redis-semantic');
  assert.equal(normalizeCacheType('qdrant-semantic'), 'qdrant-semantic');
  assert.equal(normalizeCacheType('disk'), 'disk');
  assert.equal(normalizeCacheType('memcached'), 'unknown');
  assert.equal(normalizeCacheType(''), 'unknown');
  assert.equal(normalizeCacheType(null), 'unknown');
  assert.equal(normalizeCacheType(42), 'unknown');
});

// ─── normalizeCachePolicy ─────────────────────────────────────────────────────────────────────
test('normalizeCachePolicy: reads echoed params, drops junk', () => {
  const raw: RawCachePing = {
    litellm_cache_params: {
      supported_call_types: ['completion', 'acompletion', '', 42 as unknown as string],
      ttl: 3600,
      mode: 'default_on',
      namespace: 'offgrid',
    },
  };
  const p = normalizeCachePolicy(raw);
  assert.deepEqual(p.supportedCallTypes, ['completion', 'acompletion']);
  assert.equal(p.ttlSeconds, 3600);
  assert.equal(p.mode, 'default_on');
  assert.equal(p.namespace, 'offgrid');
});

test('normalizeCachePolicy: empty policy when no params / negatives dropped', () => {
  assert.deepEqual(normalizeCachePolicy(null), {
    ttlSeconds: null,
    supportedCallTypes: [],
    mode: null,
    namespace: null,
  });
  assert.deepEqual(normalizeCachePolicy({}), {
    ttlSeconds: null,
    supportedCallTypes: [],
    mode: null,
    namespace: null,
  });
  const neg = normalizeCachePolicy({ litellm_cache_params: { ttl: -5, supported_call_types: null } });
  assert.equal(neg.ttlSeconds, null);
  assert.deepEqual(neg.supportedCallTypes, []);
  // whitespace-only mode/namespace → null
  const blank = normalizeCachePolicy({ litellm_cache_params: { mode: '   ', namespace: '' } });
  assert.equal(blank.mode, null);
  assert.equal(blank.namespace, null);
});

// ─── interpretCachePing ───────────────────────────────────────────────────────────────────────
test('interpretCachePing: healthy redis cache → enabled + healthy', () => {
  const s = interpretCachePing({
    status: 'healthy',
    cache_type: 'redis',
    ping_response: true,
    litellm_cache_params: { ttl: 600, supported_call_types: ['completion'] },
  });
  assert.equal(s.configured, true);
  assert.equal(s.reachable, true);
  assert.equal(s.cacheEnabled, true);
  assert.equal(s.healthy, true);
  assert.equal(s.type, 'redis');
  assert.equal(s.policy.ttlSeconds, 600);
});

test('interpretCachePing: ping answered but no cache wired → reachable, not enabled', () => {
  const s = interpretCachePing({ status: 'healthy', cache_type: null });
  assert.equal(s.reachable, true);
  assert.equal(s.cacheEnabled, false);
  assert.equal(s.healthy, false); // healthy is gated on cacheEnabled
  assert.equal(s.type, 'unknown');
});

test('interpretCachePing: ping_response:true alone is a healthy signal', () => {
  const s = interpretCachePing({ cache_type: 'local', ping_response: true });
  assert.equal(s.cacheEnabled, true);
  assert.equal(s.healthy, true);
});

test('interpretCachePing: enabled type but unhealthy → enabled, not healthy', () => {
  const s = interpretCachePing({ cache_type: 'redis', status: 'unhealthy', ping_response: false });
  assert.equal(s.cacheEnabled, true);
  assert.equal(s.healthy, false);
});

test('interpretCachePing: null/undefined raw degrades to unknown/unreachable-shape but reachable', () => {
  const s = interpretCachePing(null);
  assert.equal(s.reachable, true); // we got a (empty) response
  assert.equal(s.cacheEnabled, false);
  assert.equal(s.type, 'unknown');
});

// ─── status constructors ──────────────────────────────────────────────────────────────────────
test('cacheStatusUnconfigured / cacheStatusUnreachable', () => {
  const u = cacheStatusUnconfigured();
  assert.equal(u.configured, false);
  assert.equal(u.reachable, false);
  assert.equal(u.cacheEnabled, false);
  assert.equal(u.error, undefined);

  const r = cacheStatusUnreachable('boom');
  assert.equal(r.configured, true);
  assert.equal(r.reachable, false);
  assert.equal(r.error, 'boom');
});

// ─── planFlush ────────────────────────────────────────────────────────────────────────────────
test('planFlush: mode all → flushall plan', () => {
  const p = planFlush({ mode: 'all' });
  assert.deepEqual(p, { ok: true, kind: 'all' });
  assert.deepEqual(planFlush({ mode: ' ALL ' }), { ok: true, kind: 'all' });
});

test('planFlush: mode keys → deduped, trimmed key body', () => {
  const p = planFlush({ mode: 'keys', keys: [' a ', 'b', 'a', '', 3 as unknown as string] });
  assert.equal(p.ok, true);
  if (p.ok && p.kind === 'keys') {
    assert.deepEqual(p.keys, ['a', 'b']);
    assert.deepEqual(p.body, { keys: ['a', 'b'] });
  } else {
    assert.fail('expected keys plan');
  }
});

test('planFlush: keys mode rejects empty / non-array / all-blank', () => {
  assert.deepEqual(planFlush({ mode: 'keys', keys: [] }), {
    ok: false,
    error: 'keys must contain at least one non-empty key',
  });
  assert.deepEqual(planFlush({ mode: 'keys', keys: ['   ', ''] }), {
    ok: false,
    error: 'keys must contain at least one non-empty key',
  });
  assert.deepEqual(planFlush({ mode: 'keys', keys: 'nope' }), {
    ok: false,
    error: 'keys must be an array',
  });
});

test('planFlush: unknown/missing mode rejected (no silent flush)', () => {
  assert.deepEqual(planFlush({}), { ok: false, error: "mode must be 'all' or 'keys'" });
  assert.deepEqual(planFlush({ mode: 'wipe' }), { ok: false, error: "mode must be 'all' or 'keys'" });
});

test('flushAuditResource: describes plan target', () => {
  assert.equal(flushAuditResource({ ok: true, kind: 'all' }), 'cache:all');
  const keysPlan = planFlush({ mode: 'keys', keys: ['x', 'y'] });
  assert.equal(keysPlan.ok, true);
  if (keysPlan.ok) assert.equal(flushAuditResource(keysPlan), 'cache:keys(2)');
});

// ─── readCacheHit ─────────────────────────────────────────────────────────────────────────────
test('readCacheHit: bool + string forms, unknown for anything else', () => {
  assert.equal(readCacheHit(true), 'hit');
  assert.equal(readCacheHit(false), 'miss');
  assert.equal(readCacheHit('True'), 'hit');
  assert.equal(readCacheHit(' true '), 'hit');
  assert.equal(readCacheHit('1'), 'hit');
  assert.equal(readCacheHit('yes'), 'hit');
  assert.equal(readCacheHit('False'), 'miss');
  assert.equal(readCacheHit('0'), 'miss');
  assert.equal(readCacheHit('no'), 'miss');
  assert.equal(readCacheHit('None'), 'unknown');
  assert.equal(readCacheHit(''), 'unknown');
  assert.equal(readCacheHit(null), 'unknown');
  assert.equal(readCacheHit(undefined), 'unknown');
  assert.equal(readCacheHit(5), 'unknown');
});

// ─── computeCacheStats ────────────────────────────────────────────────────────────────────────
test('computeCacheStats: real hit-rate + savings over decidable rows', () => {
  const rows: RawCacheLog[] = [
    { cache_hit: true, total_tokens: 100, spend: 0.5 },
    { cache_hit: true, prompt_tokens: 40, completion_tokens: 60, spend: 0.2 },
    { cache_hit: false, total_tokens: 80, spend: 0.3 },
    { cache_hit: 'None', total_tokens: 10, spend: 0.1 }, // undecidable → ignored
  ];
  const s = computeCacheStats(rows);
  assert.equal(s.requests, 4);
  assert.equal(s.decided, 3);
  assert.equal(s.hits, 2);
  assert.equal(s.misses, 1);
  assert.equal(s.hitRate, 2 / 3);
  assert.equal(s.tokensSaved, 200); // 100 + (40+60)
  assert.equal(s.costSaved, 0.7); // 0.5 + 0.2
  assert.equal(s.markerUnavailable, false);
});

test('computeCacheStats: no decidable marker → markerUnavailable, hitRate 0', () => {
  const rows: RawCacheLog[] = [
    { total_tokens: 100, spend: 0 },
    { cache_hit: 'None', total_tokens: 50 },
    { cache_hit: null },
  ];
  const s = computeCacheStats(rows);
  assert.equal(s.requests, 3);
  assert.equal(s.decided, 0);
  assert.equal(s.hits, 0);
  assert.equal(s.misses, 0);
  assert.equal(s.hitRate, 0);
  assert.equal(s.tokensSaved, 0);
  assert.equal(s.markerUnavailable, true);
});

test('computeCacheStats: empty rows → zeroed, markerUnavailable true', () => {
  const s = computeCacheStats([]);
  assert.equal(s.requests, 0);
  assert.equal(s.decided, 0);
  assert.equal(s.markerUnavailable, true);
});

test('computeCacheStats: free on-prem hits → tokensSaved counts, costSaved $0', () => {
  const s = computeCacheStats([
    { cache_hit: true, total_tokens: 120, spend: 0 },
    { cache_hit: true, total_tokens: 80 },
  ]);
  assert.equal(s.hits, 2);
  assert.equal(s.tokensSaved, 200);
  assert.equal(s.costSaved, 0);
});

// ─── normalizeCacheLogs ───────────────────────────────────────────────────────────────────────
test('normalizeCacheLogs: objects only, non-array → []', () => {
  assert.deepEqual(normalizeCacheLogs('nope'), []);
  assert.deepEqual(normalizeCacheLogs(null), []);
  const rows = normalizeCacheLogs([{ cache_hit: true }, null, 3, { cache_hit: false }]);
  assert.equal(rows.length, 2);
});

test('normalizeCachePolicy: parses litellm_cache_params echoed as a JSON string (live redis shape)', () => {
  // LiteLLM's redis backend returned /cache/ping with litellm_cache_params as a JSON STRING, not an
  // object — the console showed dashes until this was parsed. This pins the real 2026-07-24 shape.
  const raw = {
    status: 'healthy',
    cache_type: 'redis',
    ping_response: true,
    litellm_cache_params: JSON.stringify({
      supported_call_types: ['completion', 'acompletion'],
      type: 'redis',
      namespace: 'offgrid',
      ttl: 3600,
    }),
  };
  const policy = normalizeCachePolicy(raw);
  assert.equal(policy.ttlSeconds, 3600);
  assert.equal(policy.namespace, 'offgrid');
  assert.deepEqual(policy.supportedCallTypes, ['completion', 'acompletion']);
});

test('normalizeCachePolicy: malformed JSON-string params degrade to empty (never throws)', () => {
  const policy = normalizeCachePolicy({ litellm_cache_params: '{not valid json' });
  assert.equal(policy.ttlSeconds, null);
  assert.equal(policy.namespace, null);
  assert.deepEqual(policy.supportedCallTypes, []);
});
