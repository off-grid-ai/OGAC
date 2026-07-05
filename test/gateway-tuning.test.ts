import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shapeGatewayTuning, type AggregatorConfig } from '../src/lib/gateway.ts';

// A realistic aggregator /config snapshot (mirrors what GET /config emits).
const full: AggregatorConfig = {
  readonly: true,
  routing: {
    poolSource: 'http://127.0.0.1:3000/api/v1/gateway/pool',
    poolRefreshMs: 30000,
    poolPinned: false,
    liveNodes: 5,
    poolNodes: 6,
    imageLiveNodes: 1,
    fallbackPoolNodes: 6,
  },
  health: {
    probeEnabled: true,
    windowMs: 120000,
    slowMs: 30000,
    jamMs: 90000,
    degradedErrRate: 0.25,
    downErrRate: 0.6,
    probeEveryMs: 60000,
    probeTimeoutMs: 45000,
  },
  timeouts: { chatUpstreamMs: 300000, imageUpstreamMs: 300000 },
  capabilities: { responseCache: false, perRequestFallbackChain: false, rateLimit: false, liveReconfigure: false },
};

function row(v: ReturnType<typeof shapeGatewayTuning>, group: string, key: string) {
  const g = v.groups.find((g) => g.group === group);
  assert.ok(g, `group ${group} present`);
  const r = g.rows.find((r) => r.key === key);
  assert.ok(r, `row ${key} present in ${group}`);
  return r;
}

test('shapes a full config into the three groups + capabilities', () => {
  const v = shapeGatewayTuning(full);
  assert.equal(v.readonly, true);
  assert.deepEqual(v.groups.map((g) => g.group), ['Routing', 'Health detection', 'Upstream timeouts']);
  assert.equal(v.capabilities.length, 4);
});

test('formats ms → seconds, rates → percent, counts, booleans', () => {
  const v = shapeGatewayTuning(full);
  assert.equal(row(v, 'Routing', 'poolRefreshMs').value, '30s');
  assert.equal(row(v, 'Routing', 'liveNodes').value, '5 of 6');
  assert.equal(row(v, 'Routing', 'poolPinned').value, 'off');
  assert.equal(row(v, 'Health detection', 'slowMs').value, '30s');
  assert.equal(row(v, 'Health detection', 'degradedErrRate').value, '25%');
  assert.equal(row(v, 'Health detection', 'downErrRate').value, '60%');
  assert.equal(row(v, 'Health detection', 'probeEnabled').value, 'on');
  assert.equal(row(v, 'Upstream timeouts', 'chatUpstreamMs').value, '300s');
});

test('sub-second ms values keep the ms unit', () => {
  const v = shapeGatewayTuning({ health: { windowMs: 1500 } });
  assert.equal(row(v, 'Health detection', 'windowMs').value, '1500ms');
});

test('every routing/refresh knob is labelled as restart-to-change, node counts as SSOT', () => {
  const v = shapeGatewayTuning(full);
  assert.match(row(v, 'Routing', 'poolRefreshMs').changeVia, /restart/i);
  assert.match(row(v, 'Routing', 'liveNodes').changeVia, /SSOT|Fleet/i);
  assert.match(row(v, 'Health detection', 'jamMs').changeVia, /restart/i);
});

test('capability flags are honest: cache/fallback/rate-limit/live-reconfigure all absent', () => {
  const v = shapeGatewayTuning(full);
  const byKey = Object.fromEntries(v.capabilities.map((c) => [c.key, c]));
  assert.equal(byKey.responseCache.present, false);
  assert.equal(byKey.perRequestFallbackChain.present, false);
  assert.equal(byKey.rateLimit.present, false);
  assert.equal(byKey.liveReconfigure.present, false);
  // Rate-limit note must point at Caddy/edge, not pretend it's editable here.
  assert.match(byKey.rateLimit.note, /Caddy|edge|middleware/i);
  // Fallback note must explain the real resilience source (pool + hardcoded fallback).
  assert.match(byKey.perRequestFallbackChain.note, /pool/i);
});

test('a null / offline aggregator degrades to defaults, still read-only, no crash', () => {
  const v = shapeGatewayTuning(null);
  assert.equal(v.readonly, true);
  assert.equal(v.groups.length, 3);
  // Missing values render as em-dash, never as fabricated numbers.
  assert.equal(row(v, 'Routing', 'poolRefreshMs').value, '—');
  assert.equal(row(v, 'Health detection', 'degradedErrRate').value, '—');
  assert.equal(v.capabilities.length, 4);
});

test('a partial config fills present fields and dashes the rest', () => {
  const v = shapeGatewayTuning({ routing: { liveNodes: 2, poolNodes: 3 } });
  assert.equal(row(v, 'Routing', 'liveNodes').value, '2 of 3');
  assert.equal(row(v, 'Routing', 'poolRefreshMs').value, '—');
});

test('readonly honours an explicit false but defaults to true when absent', () => {
  assert.equal(shapeGatewayTuning({ readonly: false }).readonly, false);
  assert.equal(shapeGatewayTuning({}).readonly, true);
});

test('a present capability (future aggregator) is reflected, not hardcoded off', () => {
  const v = shapeGatewayTuning({ capabilities: { responseCache: true } });
  const cache = v.capabilities.find((c) => c.key === 'responseCache');
  assert.equal(cache?.present, true);
});
