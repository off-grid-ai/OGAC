import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decideRouting,
  ruleMatchesAttributes,
  type RoutingRuleLite,
} from '../src/lib/routing-policy.ts';

// PURE unit tests for the model-routing leash — no DB, no network. This encodes the vision's
// headline promise ("external intelligence, leashed"): internal/PII data physically cannot route to
// a cloud model when egress is off, regardless of the rule. A regression here would silently break
// the core governance guarantee, so it's tested exhaustively.

function rule(over: Partial<RoutingRuleLite>): RoutingRuleLite {
  return {
    name: over.name ?? 'r',
    priority: over.priority ?? 10,
    attribute: over.attribute ?? 'data_class',
    operator: over.operator ?? 'eq',
    value: over.value ?? 'PII',
    action: over.action ?? 'block',
    model: over.model ?? '',
    fallback: over.fallback ?? '',
    enabled: over.enabled ?? true,
  };
}

test('ruleMatchesAttributes honours eq / neq / in', () => {
  assert.equal(ruleMatchesAttributes({ attribute: 'x', operator: 'eq', value: 'a' }, { x: 'a' }), true);
  assert.equal(ruleMatchesAttributes({ attribute: 'x', operator: 'eq', value: 'a' }, { x: 'b' }), false);
  assert.equal(ruleMatchesAttributes({ attribute: 'x', operator: 'neq', value: 'a' }, { x: 'b' }), true);
  assert.equal(
    ruleMatchesAttributes({ attribute: 'x', operator: 'in', value: 'a,b,c' }, { x: 'b' }),
    true,
  );
  assert.equal(
    ruleMatchesAttributes({ attribute: 'x', operator: 'in', value: 'a,b,c' }, { x: 'z' }),
    false,
  );
  // missing attribute never matches eq/in
  assert.equal(ruleMatchesAttributes({ attribute: 'x', operator: 'eq', value: 'a' }, {}), false);
});

test('no rule matches → local (safe default)', () => {
  const d = decideRouting([rule({ value: 'PII' })], { data_class: 'public' }, true);
  assert.equal(d.action, 'local');
  assert.equal(d.effective, 'local');
  assert.equal(d.matched, null);
});

test('PII → block regardless of egress', () => {
  const rules = [rule({ name: 'no PII to cloud', value: 'PII', action: 'block' })];
  for (const egress of [true, false]) {
    const d = decideRouting(rules, { data_class: 'PII' }, egress);
    assert.equal(d.effective, 'block', `PII must block with egress=${egress}`);
    assert.equal(d.matched, 'no PII to cloud');
  }
});

test('cloud action is LEASHED to block when egress is off', () => {
  const rules = [rule({ name: 'bulk→cloud', value: 'bulk', action: 'cloud', model: 'cloud-claude' })];
  const off = decideRouting(rules, { data_class: 'bulk' }, false);
  assert.equal(off.action, 'cloud', 'the rule still says cloud');
  assert.equal(off.effective, 'block', 'but egress off leashes it to block');
  assert.match(off.reason, /egress is OFF/);

  const on = decideRouting(rules, { data_class: 'bulk' }, true);
  assert.equal(on.effective, 'cloud', 'egress on lets it reach cloud');
  assert.equal(on.model, 'cloud-claude');
});

test('local action is never leashed', () => {
  const rules = [rule({ name: 'local', value: 'internal', action: 'local', model: 'gemma-local' })];
  const d = decideRouting(rules, { data_class: 'internal' }, false);
  assert.equal(d.effective, 'local');
  assert.equal(d.model, 'gemma-local');
});

test('first matching rule by ascending priority wins, order-independent', () => {
  const rules = [
    rule({ name: 'low-pri cloud', priority: 50, value: 'PII', action: 'cloud' }),
    rule({ name: 'high-pri block', priority: 1, value: 'PII', action: 'block' }),
  ];
  // Passed out of order; decideRouting sorts by priority so the block (priority 1) wins.
  const d = decideRouting(rules, { data_class: 'PII' }, true);
  assert.equal(d.matched, 'high-pri block');
  assert.equal(d.effective, 'block');
});

test('disabled rules are skipped', () => {
  const rules = [
    rule({ name: 'disabled block', priority: 1, value: 'PII', action: 'block', enabled: false }),
    rule({ name: 'enabled cloud', priority: 2, value: 'PII', action: 'cloud', model: 'c' }),
  ];
  const d = decideRouting(rules, { data_class: 'PII' }, true);
  assert.equal(d.matched, 'enabled cloud', 'disabled higher-priority rule is skipped');
});

test('unknown action is treated as block (fail safe)', () => {
  const d = decideRouting([rule({ value: 'x', action: 'wat' })], { data_class: 'x' }, true);
  assert.equal(d.effective, 'block');
});
