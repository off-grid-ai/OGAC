import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validatePolicyRule } from '../src/lib/policy-rules-policy.ts';
import {
  POLICY_TEMPLATES,
  POLICY_TEMPLATE_GROUPS,
  buildPolicyPayload,
  groupTemplates,
  ruleSummary,
  searchTemplates,
} from '../src/lib/policy-templates.ts';

test('every template produces a rule the REAL validator accepts', () => {
  for (const t of POLICY_TEMPLATES) {
    const res = validatePolicyRule(t.rule);
    assert.ok(res.ok, `template ${t.id} rejected: ${res.errors.join('; ')}`);
  }
});

test('ids are unique and groups are valid', () => {
  const ids = POLICY_TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of POLICY_TEMPLATES) {
    assert.ok((POLICY_TEMPLATE_GROUPS as readonly string[]).includes(t.group), t.id);
    assert.ok(t.title, `title ${t.id}`);
    assert.ok(t.enforces.trim(), `enforces ${t.id}`);
  }
});

test('the named catalog templates all exist', () => {
  const ids = new Set(POLICY_TEMPLATES.map((t) => t.id));
  for (const expected of [
    'data-residency-on-prem',
    'pii-egress-block',
    'model-allowlist',
    'cloud-leash',
    'rate-limit-class',
    'retention-max',
  ]) {
    assert.ok(ids.has(expected), `missing template ${expected}`);
  }
});

test('buildPolicyPayload returns the validated PolicyRuleInput', () => {
  const t = POLICY_TEMPLATES.find((x) => x.id === 'pii-egress-block')!;
  const payload = buildPolicyPayload(t);
  assert.equal(payload.attribute, 'data_class');
  assert.equal(payload.operator, 'eq');
  assert.equal(payload.value, 'pii');
  assert.equal(payload.effect, 'deny');
  assert.equal(typeof payload.priority, 'number');
  assert.ok(payload.name);
});

test('buildPolicyPayload throws on an invalid template', () => {
  assert.throws(() =>
    buildPolicyPayload({
      id: 'bad',
      group: 'Operations',
      title: 'bad',
      enforces: 'bad',
      // missing value → validator rejects
      rule: {
        name: 'bad',
        description: '',
        attribute: 'role',
        operator: 'eq',
        value: '',
        effect: 'deny',
        priority: 100,
      },
    }),
  );
});

test('ruleSummary reads as effect/attribute/operator/value', () => {
  const t = POLICY_TEMPLATES.find((x) => x.id === 'data-residency-on-prem')!;
  assert.equal(ruleSummary(t), 'deny when region neq on_prem');
});

test('searchTemplates matches and empty returns all', () => {
  assert.equal(searchTemplates([...POLICY_TEMPLATES], '').length, POLICY_TEMPLATES.length);
  const pii = searchTemplates([...POLICY_TEMPLATES], 'pii');
  assert.ok(pii.some((t) => t.id === 'pii-egress-block'));
  assert.equal(searchTemplates([...POLICY_TEMPLATES], 'zzznope').length, 0);
});

test('groupTemplates preserves order and drops empty groups', () => {
  const grouped = groupTemplates([...POLICY_TEMPLATES]);
  const expectedOrder = POLICY_TEMPLATE_GROUPS.filter((g) =>
    POLICY_TEMPLATES.some((t) => t.group === g),
  );
  assert.deepEqual(grouped.map((g) => g.group), expectedOrder);
  assert.equal(
    grouped.reduce((n, g) => n + g.items.length, 0),
    POLICY_TEMPLATES.length,
  );
});
