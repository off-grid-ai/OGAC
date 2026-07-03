import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateAlerts,
  ruleBreached,
  type ThresholdRule,
  validateThresholdRule,
} from '../src/lib/observability-thresholds.ts';

// Pure threshold validation + evaluation. No network, no mocks.

test('validateThresholdRule: accepts a well-formed drift rule', () => {
  const v = validateThresholdRule({ metric: 'drift_score', op: 'gt', value: 0.3 });
  assert.equal(v.ok, true);
  assert.deepEqual(v.rule, {
    metric: 'drift_score',
    op: 'gt',
    value: 0.3,
    severity: 'warning',
  });
});

test('validateThresholdRule: honors critical severity + rounds value', () => {
  const v = validateThresholdRule({
    metric: 'eval_pass_rate',
    op: 'lt',
    value: 0.90005,
    severity: 'critical',
  });
  assert.equal(v.rule?.severity, 'critical');
  assert.equal(v.rule?.value, 0.9);
});

test('validateThresholdRule: rejects bad metric / op / range', () => {
  assert.equal(validateThresholdRule({ metric: 'nope', op: 'gt', value: 0.3 }).ok, false);
  assert.equal(validateThresholdRule({ metric: 'drift_score', op: 'eq', value: 0.3 }).ok, false);
  assert.equal(validateThresholdRule({ metric: 'drift_score', op: 'gt', value: 2 }).ok, false);
  assert.equal(validateThresholdRule({ metric: 'drift_score', op: 'gt', value: -1 }).ok, false);
  assert.equal(validateThresholdRule({ metric: 'drift_score', op: 'gt', value: 'x' }).ok, false);
});

test('ruleBreached: all four operators', () => {
  const base: ThresholdRule = { metric: 'drift_score', op: 'gt', value: 0.3, severity: 'warning' };
  assert.equal(ruleBreached({ ...base, op: 'gt' }, 0.31), true);
  assert.equal(ruleBreached({ ...base, op: 'gt' }, 0.3), false);
  assert.equal(ruleBreached({ ...base, op: 'gte' }, 0.3), true);
  assert.equal(ruleBreached({ ...base, op: 'lt' }, 0.29), true);
  assert.equal(ruleBreached({ ...base, op: 'lte' }, 0.3), true);
  assert.equal(ruleBreached(base, NaN), false);
});

test('evaluateAlerts: fires breached rules, skips metrics with no observed value', () => {
  const rules: ThresholdRule[] = [
    { metric: 'drift_score', op: 'gt', value: 0.3, severity: 'critical' },
    { metric: 'eval_pass_rate', op: 'lt', value: 0.9, severity: 'warning' },
  ];
  const alerts = evaluateAlerts(rules, { driftScore: 0.42, evalPassRate: 0.95 });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].metric, 'drift_score');
  assert.equal(alerts[0].severity, 'critical');
  assert.match(alerts[0].message, />/);
});

test('evaluateAlerts: skips rule when observed value is null', () => {
  const rules: ThresholdRule[] = [
    { metric: 'eval_pass_rate', op: 'lt', value: 0.9, severity: 'warning' },
  ];
  assert.equal(evaluateAlerts(rules, { driftScore: 0.5, evalPassRate: null }).length, 0);
});
