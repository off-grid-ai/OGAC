import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type RawAlertsResponse,
  type RawRulesResponse,
  DEFAULT_RANGE,
  RANGE_WINDOWS,
  buildInstantQueryString,
  buildRangeQueryString,
  normalizeAlerts,
  normalizeRange,
  normalizeRules,
  partitionRules,
  promQLShapeError,
  rangeToParams,
  summarizeAlerts,
  validateSavedQuery,
} from '../src/lib/victoriametrics-query.ts';

// Pure query/response logic for the VictoriaMetrics explorer. No network, no mocks — real functions
// fed representative Prometheus-compatible JSON and raw params.

// ─── normalizeRange ─────────────────────────────────────────────────────────────
test('normalizeRange: accepts every known window verbatim', () => {
  for (const w of RANGE_WINDOWS) assert.equal(normalizeRange(w), w);
});
test('normalizeRange: trims surrounding whitespace to a known window', () => {
  assert.equal(normalizeRange('  6h  '), '6h');
});
test('normalizeRange: unknown / non-string / empty falls back to the default', () => {
  assert.equal(normalizeRange('90d'), DEFAULT_RANGE);
  assert.equal(normalizeRange(''), DEFAULT_RANGE);
  assert.equal(normalizeRange(undefined), DEFAULT_RANGE);
  assert.equal(normalizeRange(42), DEFAULT_RANGE);
  assert.equal(normalizeRange(null), DEFAULT_RANGE);
});

// ─── rangeToParams ──────────────────────────────────────────────────────────────
test('rangeToParams: span + step match the window, ending at now', () => {
  const now = new Date('2026-07-21T00:00:00Z');
  const end = Math.floor(now.getTime() / 1000);
  const p1h = rangeToParams('1h', now);
  assert.equal(p1h.end, end);
  assert.equal(p1h.start, end - 3600);
  assert.equal(p1h.step, 60);

  const p7d = rangeToParams('7d', now);
  assert.equal(p7d.start, end - 7 * 24 * 3600);
  assert.equal(p7d.step, 3600);

  assert.equal(rangeToParams('15m', now).step, 15);
  assert.equal(rangeToParams('6h', now).step, 300);
  assert.equal(rangeToParams('24h', now).step, 900);
});
test('rangeToParams: unknown window (bypassing normalize) uses the default spec', () => {
  const now = new Date('2026-07-21T00:00:00Z');
  const bad = rangeToParams('nope' as never, now);
  const def = rangeToParams(DEFAULT_RANGE, now);
  assert.deepEqual(bad, def);
});
test('rangeToParams: defaults now to current time when omitted', () => {
  const before = Math.floor(Date.now() / 1000);
  const p = rangeToParams('1h');
  assert.ok(p.end >= before);
});

// ─── query-string builders ────────────────────────────────────────────────────
test('buildInstantQueryString: encodes PromQL once, omits time by default', () => {
  const s = buildInstantQueryString('sum(rate(http_requests_total[5m]))');
  assert.ok(s.startsWith('/api/v1/query?'));
  assert.ok(s.includes('query=sum%28rate%28http_requests_total%5B5m%5D%29%29'));
  assert.ok(!s.includes('time='));
});
test('buildInstantQueryString: includes floored time when finite', () => {
  const s = buildInstantQueryString('up', 1721520000.9);
  assert.ok(s.includes('time=1721520000'));
});
test('buildInstantQueryString: ignores non-finite time', () => {
  assert.ok(!buildInstantQueryString('up', Number.NaN).includes('time='));
  assert.ok(!buildInstantQueryString('up', Infinity).includes('time='));
});
test('buildRangeQueryString: carries start/end/step and encoded query', () => {
  const s = buildRangeQueryString('up', { start: 100, end: 200, step: 15 });
  assert.ok(s.startsWith('/api/v1/query_range?'));
  assert.ok(s.includes('start=100'));
  assert.ok(s.includes('end=200'));
  assert.ok(s.includes('step=15'));
  assert.ok(s.includes('query=up'));
});

// ─── promQLShapeError ───────────────────────────────────────────────────────────
test('promQLShapeError: rejects empty / whitespace', () => {
  assert.equal(promQLShapeError(''), 'query is required');
  assert.equal(promQLShapeError('   '), 'query is required');
});
test('promQLShapeError: rejects over-length', () => {
  assert.match(promQLShapeError('a'.repeat(4001)) ?? '', /4000 characters/);
});
test('promQLShapeError: accepts balanced selectors', () => {
  assert.equal(promQLShapeError('sum(rate(m{job="x"}[5m]))'), null);
});
test('promQLShapeError: rejects unbalanced brackets (unterminated + mismatched + extra close)', () => {
  assert.equal(promQLShapeError('sum(rate(m[5m])'), 'unbalanced brackets in query');
  assert.equal(promQLShapeError('m{job="x"]'), 'unbalanced brackets in query');
  assert.equal(promQLShapeError('m)'), 'unbalanced brackets in query');
});

// ─── validateSavedQuery ─────────────────────────────────────────────────────────
test('validateSavedQuery: happy path trims + coerces range', () => {
  const v = validateSavedQuery({
    name: '  Error rate  ',
    query: '  sum(rate(errs[5m]))  ',
    range: '6h',
    description: '  p99 errors  ',
  });
  assert.ok(v.valid);
  assert.deepEqual(v.value, {
    name: 'Error rate',
    query: 'sum(rate(errs[5m]))',
    range: '6h',
    description: 'p99 errors',
  });
});
test('validateSavedQuery: defaults range + empty description when absent', () => {
  const v = validateSavedQuery({ name: 'x', query: 'up' });
  assert.ok(v.valid);
  assert.equal(v.value?.range, DEFAULT_RANGE);
  assert.equal(v.value?.description, '');
});
test('validateSavedQuery: collects every error at once', () => {
  const v = validateSavedQuery({ name: '', query: '', description: 'd'.repeat(501) });
  assert.equal(v.valid, false);
  assert.ok(v.errors.includes('name is required'));
  assert.ok(v.errors.includes('query is required'));
  assert.ok(v.errors.some((e) => /description must be/.test(e)));
  assert.equal(v.value, undefined);
});
test('validateSavedQuery: rejects over-long name and bad query shape', () => {
  const v = validateSavedQuery({ name: 'n'.repeat(121), query: 'sum(rate(' });
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => /name must be/.test(e)));
  assert.ok(v.errors.includes('unbalanced brackets in query'));
});
test('validateSavedQuery: null / non-object raw is invalid, not a throw', () => {
  assert.equal(validateSavedQuery(null).valid, false);
  assert.equal(validateSavedQuery('nope').valid, false);
});

// ─── normalizeRules ─────────────────────────────────────────────────────────────
const RULES: RawRulesResponse = {
  status: 'success',
  data: {
    groups: [
      {
        name: 'platform',
        rules: [
          {
            name: 'HighErrorRate',
            type: 'alerting',
            query: 'rate(errs[5m]) > 1',
            state: 'firing',
            health: 'ok',
            labels: { severity: 'page' },
            annotations: { summary: 'errors high' },
            alerts: [{ state: 'firing' }, { state: 'pending' }],
          },
          {
            name: 'job:errs:rate5m',
            type: 'recording',
            query: 'rate(errs[5m])',
            health: 'ok',
          },
          {
            // missing type → 'unknown'; missing everything else → safe defaults
          },
        ],
      },
      { file: '/etc/rules.yml', rules: null }, // group with no rules + no name → falls back to file
    ],
  },
};

test('normalizeRules: flattens groups, tags group, defaults missing fields', () => {
  const rules = normalizeRules(RULES);
  assert.equal(rules.length, 3);
  const [alerting, recording, unknown] = rules;
  assert.equal(alerting.type, 'alerting');
  assert.equal(alerting.group, 'platform');
  assert.equal(alerting.activeAlerts, 2);
  assert.equal(alerting.state, 'firing');
  assert.equal(recording.type, 'recording');
  assert.equal(recording.state, ''); // recording rules carry no state
  assert.equal(unknown.type, 'unknown');
  assert.equal(unknown.name, '');
  assert.equal(unknown.health, 'unknown');
  assert.equal(unknown.activeAlerts, 0);
  assert.deepEqual(unknown.labels, {});
});
test('normalizeRules: group with neither name nor file → empty group tag, rule fields all default', () => {
  const rules = normalizeRules({
    data: { groups: [{ rules: [{ name: 'r', type: 'recording', query: 'up', state: 'firing' }] }] },
  });
  assert.equal(rules[0].group, '');
  assert.equal(rules[0].state, 'firing');
});
test('normalizeRules: empty / missing / non-array → []', () => {
  assert.deepEqual(normalizeRules(null), []);
  assert.deepEqual(normalizeRules(undefined), []);
  assert.deepEqual(normalizeRules({ data: { groups: null } }), []);
  assert.deepEqual(normalizeRules({ data: { groups: 'x' as never } }), []);
});

test('partitionRules: splits by kind', () => {
  const parts = partitionRules(normalizeRules(RULES));
  assert.equal(parts.alerting.length, 1);
  assert.equal(parts.recording.length, 1);
});

// ─── normalizeAlerts + summarizeAlerts ──────────────────────────────────────────
const ALERTS: RawAlertsResponse = {
  status: 'success',
  data: {
    alerts: [
      { labels: { alertname: 'HighErrorRate', severity: 'page' }, state: 'firing', activeAt: 't1', value: '3' },
      { labels: { alertname: 'Latency' }, state: 'pending' },
      { state: 'firing' }, // no labels → name defaults, no annotations
    ],
  },
};

test('normalizeAlerts: prefers alertname label, defaults gaps', () => {
  const alerts = normalizeAlerts(ALERTS);
  assert.equal(alerts.length, 3);
  assert.equal(alerts[0].name, 'HighErrorRate');
  assert.equal(alerts[0].value, '3');
  assert.equal(alerts[1].name, 'Latency');
  assert.equal(alerts[2].name, 'alert');
  assert.deepEqual(alerts[2].labels, {});
  assert.equal(alerts[2].activeAt, '');
});
test('normalizeAlerts: state defaults to empty when absent', () => {
  const alerts = normalizeAlerts({ data: { alerts: [{ labels: { alertname: 'x' } }] } });
  assert.equal(alerts[0].state, '');
});
test('normalizeAlerts: empty / missing / non-array → []', () => {
  assert.deepEqual(normalizeAlerts(null), []);
  assert.deepEqual(normalizeAlerts({ data: { alerts: null } }), []);
  assert.deepEqual(normalizeAlerts({ data: { alerts: 5 as never } }), []);
});
test('summarizeAlerts: counts firing vs pending vs total', () => {
  const s = summarizeAlerts(normalizeAlerts(ALERTS));
  assert.deepEqual(s, { firing: 2, pending: 1, total: 3 });
});
test('summarizeAlerts: empty list is all zero', () => {
  assert.deepEqual(summarizeAlerts([]), { firing: 0, pending: 0, total: 0 });
});
