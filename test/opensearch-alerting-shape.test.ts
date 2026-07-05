import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildIsmPolicyBody,
  buildMonitorBody,
  isPluginUnsupported,
  normalizeIsmPolicy,
  normalizeMonitorSpec,
  opToPainless,
  parseCondition,
  parseIsmPolicy,
  parseMonitorGet,
  parseMonitorList,
} from '../src/lib/opensearch-alerting-shape.ts';

// Pure request/response shaping for OpenSearch alerting monitors + ISM retention policies. No
// network, no mocks — representative _plugins JSON in, asserted bodies/summaries out. Exercises the
// real builders and parsers plus the round-trip (build → parse recovers the same values).

// ── normalizeMonitorSpec ──────────────────────────────────────────────────────────────────────

test('normalizeMonitorSpec: clamps + defaults, requires name and index', () => {
  assert.equal(normalizeMonitorSpec({ index: 'x' }), null, 'no name → null');
  assert.equal(normalizeMonitorSpec({ name: 'x' }), null, 'no index → null');

  const s = normalizeMonitorSpec({
    name: '  blocked-spike  ',
    index: 'offgrid-audit',
    outcome: 'blocked',
    windowMinutes: '5',
    intervalMinutes: 0, // below min → clamped to 1
    threshold: -3, // below min → clamped to 0
    op: 'bogus', // invalid → default gt
  });
  assert.ok(s);
  assert.equal(s.name, 'blocked-spike');
  assert.equal(s.windowMinutes, 5);
  assert.equal(s.intervalMinutes, 1);
  assert.equal(s.threshold, 0);
  assert.equal(s.op, 'gt');
  assert.equal(s.enabled, true);
});

test('normalizeMonitorSpec: enabled:false is respected, op passthrough', () => {
  const s = normalizeMonitorSpec({ name: 'n', index: 'i', op: 'gte', enabled: false });
  assert.ok(s);
  assert.equal(s.enabled, false);
  assert.equal(s.op, 'gte');
});

// ── buildMonitorBody ──────────────────────────────────────────────────────────────────────────

test('buildMonitorBody: query-level monitor with time-window + outcome filter + threshold trigger', () => {
  const spec = normalizeMonitorSpec({
    name: 'blocked-spike',
    index: 'offgrid-audit',
    outcome: 'blocked',
    windowMinutes: 5,
    intervalMinutes: 5,
    threshold: 10,
    op: 'gt',
  })!;
  const body = buildMonitorBody(spec) as any;

  assert.equal(body.monitor_type, 'query_level_monitor');
  assert.equal(body.name, 'blocked-spike');
  assert.deepEqual(body.schedule, { period: { interval: 5, unit: 'MINUTES' } });

  const search = body.inputs[0].search;
  assert.deepEqual(search.indices, ['offgrid-audit']);
  const filter = search.query.query.bool.filter;
  assert.deepEqual(filter[0], { range: { ts: { gte: 'now-5m', lte: 'now' } } });
  assert.deepEqual(filter[1], { term: { 'outcome.keyword': 'blocked' } });
  assert.equal(search.query.size, 0);

  const trig = body.triggers[0];
  assert.equal(trig.name, 'blocked-spike-trigger');
  assert.equal(trig.condition.script.lang, 'painless');
  assert.equal(trig.condition.script.source, 'ctx.results[0].hits.total.value > 10');
});

test('buildMonitorBody: blank outcome → no outcome filter (counts all)', () => {
  const spec = normalizeMonitorSpec({ name: 'all', index: 'offgrid-gateway', outcome: '' })!;
  const filter = (buildMonitorBody(spec) as any).inputs[0].search.query.query.bool.filter;
  assert.equal(filter.length, 1, 'only the time-window filter');
});

test('opToPainless maps all four operators', () => {
  assert.equal(opToPainless('gt'), '>');
  assert.equal(opToPainless('gte'), '>=');
  assert.equal(opToPainless('lt'), '<');
  assert.equal(opToPainless('lte'), '<=');
});

test('parseCondition recovers op + threshold from a painless source', () => {
  assert.deepEqual(parseCondition('ctx.results[0].hits.total.value >= 42'), {
    op: 'gte',
    threshold: 42,
  });
  assert.deepEqual(parseCondition('something else'), { op: null, threshold: null });
  assert.deepEqual(parseCondition(undefined), { op: null, threshold: null });
});

// ── monitor list/get parsing + round-trip ───────────────────────────────────────────────────────

// A realistic `_plugins/_alerting/monitors/_search` response (trimmed).
const MONITOR_SEARCH = {
  hits: {
    total: { value: 2 },
    hits: [
      {
        _id: 'mon-b',
        _seq_no: 7,
        _primary_term: 1,
        _source: {
          name: 'zeta-monitor',
          enabled: true,
          schedule: { period: { interval: 3, unit: 'MINUTES' } },
          inputs: [{ search: { indices: ['offgrid-audit'], query: { size: 0, query: {} } } }],
          triggers: [
            {
              name: 'zeta-trigger',
              condition: { script: { source: 'ctx.results[0].hits.total.value > 5', lang: 'painless' } },
            },
          ],
        },
      },
      {
        _id: 'mon-a',
        _seq_no: 2,
        _primary_term: 1,
        _source: {
          name: 'alpha-monitor',
          enabled: false,
          schedule: { period: { interval: 10, unit: 'MINUTES' } },
          inputs: [{ search: { indices: ['offgrid-gateway'] } }],
          triggers: [
            {
              name: 'alpha-trigger',
              condition: { script: { source: 'ctx.results[0].hits.total.value >= 100' } },
            },
          ],
        },
      },
    ],
  },
};

test('parseMonitorList: flattens hits, name-sorted, recovers condition + seq numbers', () => {
  const list = parseMonitorList(MONITOR_SEARCH);
  assert.equal(list.length, 2);
  // Sorted by name: alpha before zeta.
  assert.deepEqual(
    list.map((m) => m.name),
    ['alpha-monitor', 'zeta-monitor'],
  );
  const alpha = list[0];
  assert.equal(alpha.id, 'mon-a');
  assert.equal(alpha.enabled, false);
  assert.equal(alpha.index, 'offgrid-gateway');
  assert.equal(alpha.intervalMinutes, 10);
  assert.equal(alpha.threshold, 100);
  assert.equal(alpha.op, 'gte');
  assert.equal(alpha.seqNo, 2);
  assert.equal(alpha.primaryTerm, 1);

  const zeta = list[1];
  assert.equal(zeta.op, 'gt');
  assert.equal(zeta.threshold, 5);
  assert.equal(zeta.intervalMinutes, 3);
});

test('parseMonitorList: empty/absent → empty array', () => {
  assert.deepEqual(parseMonitorList(null), []);
  assert.deepEqual(parseMonitorList({}), []);
  assert.deepEqual(parseMonitorList({ hits: { hits: [] } }), []);
});

test('parseMonitorGet: single { _id, monitor } shape', () => {
  const got = parseMonitorGet({
    _id: 'mon-x',
    _seq_no: 9,
    _primary_term: 4,
    monitor: {
      name: 'x',
      enabled: true,
      schedule: { period: { interval: 5, unit: 'MINUTES' } },
      inputs: [{ search: { indices: ['offgrid-audit'] } }],
      triggers: [{ name: 't', condition: { script: { source: 'ctx.results[0].hits.total.value < 2' } } }],
    },
  });
  assert.ok(got);
  assert.equal(got.id, 'mon-x');
  assert.equal(got.op, 'lt');
  assert.equal(got.threshold, 2);
  assert.equal(got.seqNo, 9);
  assert.equal(parseMonitorGet(null), null);
  assert.equal(parseMonitorGet({}), null);
});

test('monitor round-trip: build → wrap as GET → parse recovers op/threshold/index', () => {
  const spec = normalizeMonitorSpec({
    name: 'rt',
    index: 'offgrid-audit',
    outcome: 'denied',
    threshold: 7,
    op: 'lte',
    intervalMinutes: 15,
  })!;
  const body = buildMonitorBody(spec);
  const parsed = parseMonitorGet({ _id: 'rt-id', monitor: body as Record<string, unknown> })!;
  assert.equal(parsed.index, 'offgrid-audit');
  assert.equal(parsed.op, 'lte');
  assert.equal(parsed.threshold, 7);
  assert.equal(parsed.intervalMinutes, 15);
});

// ── ISM policy shaping ───────────────────────────────────────────────────────────────────────

test('normalizeIsmPolicy: requires policyId, clamps retention, defaults pattern', () => {
  assert.equal(normalizeIsmPolicy({}), null);
  const p = normalizeIsmPolicy({ policyId: 'offgrid-audit-retention', retentionDays: 0 })!;
  assert.equal(p.retentionDays, 1, 'clamped up to min 1');
  assert.deepEqual(p.indexPatterns, ['offgrid-audit*'], 'derived from policyId sans -retention');
  assert.equal(p.rolloverAgeDays, 0);
});

test('buildIsmPolicyBody: hot→delete states, rollover gated by age/size, ism_template bound', () => {
  const spec = normalizeIsmPolicy({
    policyId: 'offgrid-audit-retention',
    indexPatterns: ['offgrid-audit*', 'offgrid-gateway*'],
    rolloverAgeDays: 1,
    rolloverSizeGb: 25,
    retentionDays: 90,
  })!;
  const body = buildIsmPolicyBody(spec) as any;
  const policy = body.policy;
  assert.equal(policy.policy_id, 'offgrid-audit-retention');
  assert.equal(policy.default_state, 'hot');

  const hot = policy.states.find((s: any) => s.name === 'hot');
  assert.deepEqual(hot.actions[0].rollover, { min_index_age: '1d', min_primary_shard_size: '25gb' });
  assert.deepEqual(hot.transitions[0], {
    state_name: 'delete',
    conditions: { min_index_age: '90d' },
  });

  const del = policy.states.find((s: any) => s.name === 'delete');
  assert.deepEqual(del.actions[0], { delete: {} });

  assert.deepEqual(policy.ism_template[0].index_patterns, ['offgrid-audit*', 'offgrid-gateway*']);
});

test('buildIsmPolicyBody: no rollover thresholds → empty hot actions', () => {
  const spec = normalizeIsmPolicy({ policyId: 'p', retentionDays: 30 })!;
  const hot = (buildIsmPolicyBody(spec) as any).policy.states.find((s: any) => s.name === 'hot');
  assert.deepEqual(hot.actions, []);
});

test('parseIsmPolicy: recovers retention/rollover/patterns + seq numbers', () => {
  const spec = normalizeIsmPolicy({
    policyId: 'offgrid-audit-retention',
    indexPatterns: ['offgrid-audit*'],
    rolloverAgeDays: 2,
    rolloverSizeGb: 50,
    retentionDays: 120,
    description: 'audit retention',
  })!;
  // A realistic GET response envelope wrapping the built policy.
  const getResponse = {
    _id: 'offgrid-audit-retention',
    _seq_no: 11,
    _primary_term: 3,
    policy: (buildIsmPolicyBody(spec) as any).policy,
  };
  const summary = parseIsmPolicy(getResponse)!;
  assert.equal(summary.policyId, 'offgrid-audit-retention');
  assert.equal(summary.retentionDays, 120);
  assert.equal(summary.rolloverAgeDays, 2);
  assert.equal(summary.rolloverSizeGb, 50);
  assert.deepEqual(summary.indexPatterns, ['offgrid-audit*']);
  assert.equal(summary.seqNo, 11);
  assert.equal(summary.primaryTerm, 3);
  assert.equal(summary.description, 'audit retention');
});

test('parseIsmPolicy: null / missing policy → null', () => {
  assert.equal(parseIsmPolicy(null), null);
  assert.equal(parseIsmPolicy({}), null);
  assert.equal(parseIsmPolicy({ _id: 'x' }), null);
});

// ── graceful-unsupported detection ─────────────────────────────────────────────────────────────

test('isPluginUnsupported: 404/405/501 and "no handler found" bodies flag missing plugin', () => {
  assert.equal(isPluginUnsupported(404, ''), true);
  assert.equal(isPluginUnsupported(405, ''), true);
  assert.equal(isPluginUnsupported(501, ''), true);
  assert.equal(isPluginUnsupported(400, 'no handler found for uri [/_plugins/_ism/policies/x]'), true);
  assert.equal(isPluginUnsupported(400, 'Invalid request'), false);
  assert.equal(isPluginUnsupported(200, ''), false);
});
