import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type PolicyRule,
  toOpaDocument,
  validatePolicyRule,
  validatePolicyRulePatch,
} from '../src/lib/policy-rules-policy.ts';

test('accepts a well-formed rule and trims/coerces', () => {
  const r = validatePolicyRule({
    name: '  block pii egress  ',
    description: '',
    attribute: 'data_class',
    operator: 'eq',
    value: ' pii ',
    effect: 'deny',
    priority: '10',
  });
  assert.ok(r.ok);
  assert.equal(r.value?.name, 'block pii egress');
  assert.equal(r.value?.value, 'pii');
  assert.equal(r.value?.priority, 10);
});

test('defaults priority to 100 when absent', () => {
  const r = validatePolicyRule({
    name: 'x',
    attribute: 'role',
    operator: 'eq',
    value: 'admin',
    effect: 'allow',
  });
  assert.ok(r.ok);
  assert.equal(r.value?.priority, 100);
});

test('rejects missing required fields', () => {
  const r = validatePolicyRule({ operator: 'eq', effect: 'deny' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('name')));
  assert.ok(r.errors.some((e) => e.includes('attribute')));
  assert.ok(r.errors.some((e) => e.includes('value')));
});

test('rejects invalid enum values', () => {
  const r = validatePolicyRule({
    name: 'x',
    attribute: 'role',
    operator: 'like',
    value: 'admin',
    effect: 'maybe',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('effect')));
  assert.ok(r.errors.some((e) => e.includes('operator')));
});

test('rejects bad attribute characters and out-of-range priority', () => {
  const r = validatePolicyRule({
    name: 'x',
    attribute: 'has space',
    operator: 'eq',
    value: 'v',
    effect: 'deny',
    priority: 99999,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('attribute')));
  assert.ok(r.errors.some((e) => e.includes('priority')));
});

test('patch validates only provided keys', () => {
  const r = validatePolicyRulePatch({ priority: 5 });
  assert.ok(r.ok);
  assert.deepEqual(r.value, { priority: 5 });
});

test('patch rejects empty payload', () => {
  const r = validatePolicyRulePatch({});
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('no updatable fields')));
});

test('patch rejects a bad enum but keeps others out', () => {
  const r = validatePolicyRulePatch({ effect: 'nope', name: 'ok' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('effect')));
});

test('patch enabled must be boolean', () => {
  assert.equal(validatePolicyRulePatch({ enabled: 'true' }).ok, false);
  assert.equal(validatePolicyRulePatch({ enabled: false }).ok, true);
});

function rule(p: Partial<PolicyRule>): PolicyRule {
  return {
    id: p.id ?? 'r',
    name: p.name ?? 'r',
    description: '',
    attribute: p.attribute ?? 'role',
    operator: p.operator ?? 'eq',
    value: p.value ?? 'v',
    effect: p.effect ?? 'allow',
    priority: p.priority ?? 100,
    enabled: p.enabled ?? true,
  };
}

test('toOpaDocument drops disabled and sorts deny-first then by priority', () => {
  const doc = toOpaDocument(
    [
      rule({ id: 'a', effect: 'allow', priority: 10 }),
      rule({ id: 'd2', effect: 'deny', priority: 50 }),
      rule({ id: 'd1', effect: 'deny', priority: 20 }),
      rule({ id: 'off', effect: 'deny', priority: 1, enabled: false }),
    ],
    7,
  );
  assert.equal(doc.version, 7);
  assert.deepEqual(
    doc.entries.map((e) => e.id),
    ['d1', 'd2', 'a'],
  );
});

test('toOpaDocument on empty set yields no entries', () => {
  assert.deepEqual(toOpaDocument([]).entries, []);
});
