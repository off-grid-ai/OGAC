import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compare,
  evaluateRule,
  metricValue,
  validateRule,
  validateView,
} from '../src/lib/analytics-rules-policy.ts';

// Unit tests for the PURE analytics-rules logic — NO mocks, no I/O, no db. These cover rule +
// view validation, the comparator application, the firing decision, and metric extraction.

test('validateRule accepts a well-formed rule and normalizes it', () => {
  const v = validateRule({
    name: '  p95 latency  ',
    metric: 'p95',
    comparator: 'gt',
    threshold: 2000,
    windowMinutes: 15.7,
  });
  assert.equal(v.valid, true);
  assert.deepEqual(v.value, {
    name: 'p95 latency',
    metric: 'p95',
    comparator: 'gt',
    threshold: 2000,
    windowMinutes: 15, // floored
    enabled: true, // defaulted
  });
});

test('validateRule collects errors for bad input', () => {
  const v = validateRule({ name: '', metric: 'nope', comparator: 'xx', threshold: 'x', windowMinutes: 0 });
  assert.equal(v.valid, false);
  assert.equal(v.value, undefined);
  assert.ok(v.errors.some((e) => e.includes('name')));
  assert.ok(v.errors.some((e) => e.includes('metric')));
  assert.ok(v.errors.some((e) => e.includes('comparator')));
  assert.ok(v.errors.some((e) => e.includes('threshold')));
  assert.ok(v.errors.some((e) => e.includes('windowMinutes')));
});

test('validateRule rejects an over-long name', () => {
  const v = validateRule({
    name: 'x'.repeat(121),
    metric: 'p50',
    comparator: 'lt',
    threshold: 1,
    windowMinutes: 5,
  });
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.includes('120')));
});

test('validateRule honors an explicit enabled=false', () => {
  const v = validateRule({
    name: 'x',
    metric: 'egressRate',
    comparator: 'gte',
    threshold: 10,
    windowMinutes: 30,
    enabled: false,
  });
  assert.equal(v.valid, true);
  assert.equal(v.value?.enabled, false);
});

test('compare applies each comparator', () => {
  assert.equal(compare(3, 'gt', 2), true);
  assert.equal(compare(2, 'gt', 2), false);
  assert.equal(compare(2, 'gte', 2), true);
  assert.equal(compare(1, 'lt', 2), true);
  assert.equal(compare(2, 'lte', 2), true);
  assert.equal(compare(3, 'lte', 2), false);
});

test('evaluateRule: value crossing threshold fires', () => {
  const rule = { enabled: true, comparator: 'gt', threshold: 2000 };
  assert.equal(evaluateRule(rule, 2500), true);
  assert.equal(evaluateRule(rule, 1500), false);
  assert.equal(evaluateRule(rule, 2000), false); // strict gt at boundary
});

test('evaluateRule: a disabled rule never fires', () => {
  const rule = { enabled: false, comparator: 'gt', threshold: 0 };
  assert.equal(evaluateRule(rule, 999999), false);
});

test('metricValue extracts scalars and computes blockedRate', () => {
  const a = {
    p50: 120,
    p95: 2400,
    totalEvents: 100,
    totalTokens: 50000,
    egressRate: 3.2,
    outcomes: { ok: 80, redacted: 5, blocked: 15 },
  };
  assert.equal(metricValue(a, 'p50'), 120);
  assert.equal(metricValue(a, 'p95'), 2400);
  assert.equal(metricValue(a, 'totalEvents'), 100);
  assert.equal(metricValue(a, 'totalTokens'), 50000);
  assert.equal(metricValue(a, 'egressRate'), 3.2);
  // (15 blocked + 5 redacted) / 100 = 20.0%
  assert.equal(metricValue(a, 'blockedRate'), 20);
});

test('metricValue blockedRate is 0 with no events', () => {
  const a = {
    p50: 0,
    p95: 0,
    totalEvents: 0,
    totalTokens: 0,
    egressRate: 0,
    outcomes: { ok: 0, redacted: 0, blocked: 0 },
  };
  assert.equal(metricValue(a, 'blockedRate'), 0);
});

test('validateView normalizes defaults and rejects empty name', () => {
  const ok = validateView({ name: '  Prod errors ', outcome: 'blocked' });
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.value, { name: 'Prod errors', range: '7d', model: '', outcome: 'blocked' });

  const bad = validateView({ name: '   ' });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((e) => e.includes('name')));
});
