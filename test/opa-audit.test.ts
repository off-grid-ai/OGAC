import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type OpaDecisionEvent,
  type RawDecisionEvent,
  aggregateDecisions,
  extractEventArray,
  filterDecisions,
  MAX_QUERY_LIMIT,
  normalizeBundleStatus,
  normalizeDecisionEvent,
  normalizeDecisionEvents,
  normalizeLoadedPolicies,
  normalizeOpaConfig,
  readAllow,
  validateDecisionQuery,
} from '../src/lib/opa-audit.ts';

// ─── readAllow ────────────────────────────────────────────────────────────────
test('readAllow: boolean / nested result / string forms, default deny', () => {
  assert.equal(readAllow({ allow: true }), true);
  assert.equal(readAllow({ allow: false }), false);
  assert.equal(readAllow({ allowed: true }), true);
  assert.equal(readAllow({ decision: 'allow' }), true);
  assert.equal(readAllow({ decision: 'DENY' }), false);
  assert.equal(readAllow({ result: { allow: true } }), true);
  assert.equal(readAllow({ result: { allowed: false } }), false);
  assert.equal(readAllow({ result: true }), true);
  assert.equal(readAllow({ result: 'allowed' }), true);
  assert.equal(readAllow({ result: 'denied' }), false);
  // unknown / absent → deny
  assert.equal(readAllow({}), false);
  assert.equal(readAllow({ decision: 'maybe' }), false);
  assert.equal(readAllow({ result: null }), false);
  assert.equal(readAllow({ result: 42 }), false);
});

// ─── normalizeDecisionEvent ─────────────────────────────────────────────────────
test('normalizeDecisionEvent: full OPA event → stable row', () => {
  const raw: RawDecisionEvent = {
    decision_id: 'dec-1',
    path: 'offgrid/authz',
    input: { role: 'admin', resource: 'secrets' },
    result: { allow: true },
    reason: 'OPA decision',
    requested_by: '10.0.0.1',
    timestamp: '2026-07-01T10:00:00Z',
    labels: { id: 'node-1', version: '0.70.0', num: 3, flag: true },
  };
  const e = normalizeDecisionEvent(raw);
  assert.equal(e.decisionId, 'dec-1');
  assert.equal(e.path, 'offgrid/authz');
  assert.equal(e.allow, true);
  assert.equal(e.reason, 'OPA decision');
  assert.equal(e.actor, '10.0.0.1');
  assert.equal(e.engine, 'opa');
  assert.equal(e.timestamp, '2026-07-01T10:00:00.000Z');
  assert.deepEqual(e.input, { role: 'admin', resource: 'secrets' });
  assert.deepEqual(e.labels, { id: 'node-1', version: '0.70.0', num: '3', flag: 'true' });
});

test('normalizeDecisionEvent: fallbacks — synthesized id, query→path, actor field, engine, bad ts', () => {
  const e = normalizeDecisionEvent({ query: 'offgrid/rbac', actor: 'svc', engine: 'abac' }, 7);
  assert.equal(e.decisionId, 'decision-7');
  assert.equal(e.path, 'offgrid/rbac');
  assert.equal(e.actor, 'svc');
  assert.equal(e.engine, 'abac');
  assert.equal(e.timestamp, '');
  assert.equal(e.input, null);
  assert.equal(e.result, null);

  // id fallback chain: decision_id absent, id present
  assert.equal(normalizeDecisionEvent({ id: 'x' }).decisionId, 'x');
  // default path when nothing present
  assert.equal(normalizeDecisionEvent({}).path, 'offgrid/authz');
  // unparseable timestamp → ''
  assert.equal(normalizeDecisionEvent({ timestamp: 'not-a-date' }).timestamp, '');
  // numeric epoch timestamp is accepted
  assert.equal(normalizeDecisionEvent({ time: 0 }).timestamp, new Date(0).toISOString());
  // array input is not a record → null
  assert.equal(normalizeDecisionEvent({ input: [1, 2] }).input, null);
  // non-object labels → {}
  assert.deepEqual(normalizeDecisionEvent({ labels: 'x' }).labels, {});
});

// ─── extractEventArray / normalizeDecisionEvents ────────────────────────────────
test('extractEventArray: bare array, envelopes, and junk', () => {
  assert.equal(extractEventArray([{ id: 'a' }]).length, 1);
  assert.equal(extractEventArray({ data: [{ id: 'a' }] }).length, 1);
  assert.equal(extractEventArray({ decisions: [{ id: 'a' }, { id: 'b' }] }).length, 2);
  assert.equal(extractEventArray({ result: [{ id: 'a' }] }).length, 1);
  assert.equal(extractEventArray({ nope: [1] }).length, 0);
  assert.equal(extractEventArray(null).length, 0);
  assert.equal(extractEventArray('str').length, 0);
});

test('normalizeDecisionEvents: batch normalizes with indices', () => {
  const rows = normalizeDecisionEvents([{ decision_id: 'a', allow: true }, {}]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].decisionId, 'a');
  assert.equal(rows[1].decisionId, 'decision-1');
  // null element degrades to an empty record row
  assert.equal(normalizeDecisionEvents([null])[0].decisionId, 'decision-0');
});

// ─── validateDecisionQuery ──────────────────────────────────────────────────────
test('validateDecisionQuery: limit clamping + defaults', () => {
  assert.equal(validateDecisionQuery({ limit: '25' }).limit, 25);
  assert.equal(validateDecisionQuery({ limit: '99999' }).limit, MAX_QUERY_LIMIT);
  assert.equal(validateDecisionQuery({ limit: '0' }).limit, 100);
  assert.equal(validateDecisionQuery({ limit: '-5' }).limit, 100);
  assert.equal(validateDecisionQuery({ limit: 'abc' }).limit, 100);
  assert.equal(validateDecisionQuery({ limit: null }).limit, 100);
  assert.equal(validateDecisionQuery({ limit: '12.9' }).limit, 12);
});

test('validateDecisionQuery: decision / path / since normalization', () => {
  assert.equal(validateDecisionQuery({ decision: 'ALLOW' }).decision, 'allow');
  assert.equal(validateDecisionQuery({ decision: 'deny' }).decision, 'deny');
  assert.equal(validateDecisionQuery({ decision: 'weird' }).decision, 'all');
  assert.equal(validateDecisionQuery({}).decision, 'all');
  assert.equal(validateDecisionQuery({ path: '  offgrid  ' }).path, 'offgrid');
  const q = validateDecisionQuery({ since: '2026-07-01T00:00:00Z' });
  assert.equal(q.since, '2026-07-01T00:00:00.000Z');
  assert.equal(validateDecisionQuery({ since: 'garbage' }).since, '');
  assert.equal(validateDecisionQuery({ since: '' }).since, '');
});

// ─── filterDecisions ──────────────────────────────────────────────────────────
function ev(over: Partial<OpaDecisionEvent>): OpaDecisionEvent {
  return {
    decisionId: 'd',
    path: 'offgrid/authz',
    allow: true,
    reason: '',
    engine: 'opa',
    actor: '',
    timestamp: '2026-07-01T10:00:00.000Z',
    input: null,
    result: null,
    labels: {},
    ...over,
  };
}

test('filterDecisions: decision, path, since, limit', () => {
  const events = [
    ev({ decisionId: '1', allow: true, path: 'offgrid/authz', timestamp: '2026-07-03T00:00:00.000Z' }),
    ev({ decisionId: '2', allow: false, path: 'offgrid/rbac', timestamp: '2026-07-02T00:00:00.000Z' }),
    ev({ decisionId: '3', allow: true, path: 'offgrid/authz', timestamp: '' }),
  ];
  assert.deepEqual(
    filterDecisions(events, validateDecisionQuery({ decision: 'allow' })).map((e) => e.decisionId),
    ['1', '3'],
  );
  assert.deepEqual(
    filterDecisions(events, validateDecisionQuery({ decision: 'deny' })).map((e) => e.decisionId),
    ['2'],
  );
  assert.deepEqual(
    filterDecisions(events, validateDecisionQuery({ path: 'rbac' })).map((e) => e.decisionId),
    ['2'],
  );
  // since excludes older + empty-timestamp rows
  assert.deepEqual(
    filterDecisions(events, validateDecisionQuery({ since: '2026-07-02T12:00:00Z' })).map(
      (e) => e.decisionId,
    ),
    ['1'],
  );
  // limit caps
  assert.equal(filterDecisions(events, validateDecisionQuery({ limit: '1' })).length, 1);
});

// ─── aggregateDecisions ─────────────────────────────────────────────────────────
test('aggregateDecisions: counts by allow/deny/engine/path', () => {
  const agg = aggregateDecisions([
    ev({ allow: true, engine: 'opa', path: 'offgrid/authz' }),
    ev({ allow: false, engine: 'opa', path: 'offgrid/authz' }),
    ev({ allow: true, engine: 'abac', path: 'offgrid/rbac' }),
  ]);
  assert.equal(agg.total, 3);
  assert.equal(agg.allow, 2);
  assert.equal(agg.deny, 1);
  assert.deepEqual(agg.byEngine, { opa: 2, abac: 1 });
  assert.deepEqual(agg.byPath, { 'offgrid/authz': 2, 'offgrid/rbac': 1 });
  const empty = aggregateDecisions([]);
  assert.equal(empty.total, 0);
});

// ─── normalizeOpaConfig ─────────────────────────────────────────────────────────
test('normalizeOpaConfig: live on-prem shape (no bundles, no decision_logs)', () => {
  const live = {
    result: {
      default_authorization_decision: '/system/authz/allow',
      default_decision: '/system/main',
      labels: { id: '93cfc78e', version: '0.70.0' },
    },
  };
  const c = normalizeOpaConfig(live);
  assert.equal(c.decisionLogsConfigured, false);
  assert.equal(c.decisionLogService, '');
  assert.deepEqual(c.bundles, []);
  assert.equal(c.defaultDecision, '/system/main');
  assert.equal(c.defaultAuthzDecision, '/system/authz/allow');
  assert.deepEqual(c.labels, { id: '93cfc78e', version: '0.70.0' });
});

test('normalizeOpaConfig: configured bundles + decision logs', () => {
  const c = normalizeOpaConfig({
    result: {
      decision_logs: { service: 'console' },
      bundles: {
        authz: { service: 's1', resource: 'bundles/authz.tar.gz', polling: { min_delay_seconds: 10 } },
        rbac: { service: 's2', resource: 'bundles/rbac.tar.gz' },
      },
    },
  });
  assert.equal(c.decisionLogsConfigured, true);
  assert.equal(c.decisionLogService, 'console');
  assert.equal(c.bundles.length, 2);
  // sorted by name; polling flag reflects presence of a polling object
  assert.equal(c.bundles[0].name, 'authz');
  assert.equal(c.bundles[0].polling, true);
  assert.equal(c.bundles[1].polling, false);
  // no-result / junk inputs degrade safely
  assert.deepEqual(normalizeOpaConfig(null).bundles, []);
  assert.equal(normalizeOpaConfig({ result: { bundles: 'x' } }).bundles.length, 0);
  assert.equal(normalizeOpaConfig({ default_decision: '/x' }).defaultDecision, '/x');
});

// ─── normalizeBundleStatus ──────────────────────────────────────────────────────
test('normalizeBundleStatus: disabled plugin (live shape) → statusPluginEnabled false', () => {
  const s = normalizeBundleStatus({ code: 'internal_error', message: 'status plugin not enabled' });
  assert.equal(s.statusPluginEnabled, false);
  assert.deepEqual(s.activations, []);
});

test('normalizeBundleStatus: enabled plugin with activations + error', () => {
  const s = normalizeBundleStatus({
    result: {
      bundles: {
        authz: {
          active_revision: 'rev-42',
          last_successful_activation: '2026-07-01T10:00:00Z',
          last_request: '2026-07-01T10:05:00Z',
        },
        rbac: { code: 'bundle_error', message: 'download failed', last_request: 'bad-date' },
      },
    },
  });
  assert.equal(s.statusPluginEnabled, true);
  assert.equal(s.activations.length, 2);
  assert.equal(s.activations[0].name, 'authz');
  assert.equal(s.activations[0].activeRevision, 'rev-42');
  assert.equal(s.activations[0].lastSuccessfulActivation, '2026-07-01T10:00:00.000Z');
  assert.equal(s.activations[0].code, '');
  assert.equal(s.activations[1].code, 'bundle_error');
  assert.equal(s.activations[1].message, 'download failed');
  assert.equal(s.activations[1].lastRequest, ''); // bad date → ''
  // bundles at top level (no result wrapper) + junk
  assert.equal(normalizeBundleStatus({ bundles: {} }).activations.length, 0);
  assert.equal(normalizeBundleStatus(null).activations.length, 0);
  assert.equal(normalizeBundleStatus({ bundles: 'x' }).activations.length, 0);
  // an internal_error that is NOT the status-plugin signal is treated as enabled-but-empty
  assert.equal(
    normalizeBundleStatus({ code: 'internal_error', message: 'other' }).statusPluginEnabled,
    true,
  );
});

// ─── normalizeLoadedPolicies ────────────────────────────────────────────────────
test('normalizeLoadedPolicies: live offgrid_authz module', () => {
  const live = {
    result: [
      {
        id: 'offgrid_authz',
        raw: 'package offgrid.authz\ndefault allow := false\n',
        ast: {
          package: {
            path: [
              { type: 'var', value: 'data' },
              { type: 'string', value: 'offgrid' },
              { type: 'string', value: 'authz' },
            ],
          },
          rules: [{}, {}, {}],
        },
      },
    ],
  };
  const p = normalizeLoadedPolicies(live);
  assert.equal(p.length, 1);
  assert.equal(p[0].id, 'offgrid_authz');
  assert.equal(p[0].package, 'offgrid.authz');
  assert.equal(p[0].ruleCount, 3);
  assert.ok(p[0].sourceBytes > 0);
});

test('normalizeLoadedPolicies: missing ast/raw, filtering, and junk', () => {
  const p = normalizeLoadedPolicies([{ id: 'a' }, { id: '' }, {}]);
  assert.equal(p.length, 1); // only 'a' survives the id filter
  assert.equal(p[0].package, '');
  assert.equal(p[0].ruleCount, 0);
  assert.equal(p[0].sourceBytes, 0);
  assert.deepEqual(normalizeLoadedPolicies(null), []);
  assert.deepEqual(normalizeLoadedPolicies({ result: 'x' }), []);
  // ast present but no package path
  assert.equal(normalizeLoadedPolicies([{ id: 'b', ast: {} }])[0].package, '');
  assert.equal(normalizeLoadedPolicies([{ id: 'c', ast: { package: { path: 'x' } } }])[0].package, '');
});
