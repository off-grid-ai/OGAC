import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type EdgeIntent,
  defaultIntent,
  diffIntent,
  removeRule,
  ruleIdFromName,
  setWafEnabled,
  upsertRule,
  validateRule,
} from '../src/lib/edge-intent.ts';

// PURE edge-WAF intent logic (Task C3). No I/O, no mocks — real functions locking the WAF-rule
// contract: validation, id derivation, upsert/remove/toggle immutability, and the live-vs-desired
// diff that drives the honest "pending — applies on next edge reload" label.

const FIXED = () => new Date('2026-07-08T00:00:00.000Z');

test('defaultIntent: WAF on, no rules', () => {
  const i = defaultIntent(FIXED);
  assert.equal(i.wafEnabled, true);
  assert.deepEqual(i.rules, []);
  assert.equal(i.updatedAt, '2026-07-08T00:00:00.000Z');
});

test('ruleIdFromName slugifies to a safe id', () => {
  assert.equal(ruleIdFromName('Block WP-Admin Scanners!'), 'block-wp-admin-scanners');
  assert.equal(ruleIdFromName('  Trim  Me  '), 'trim-me');
});

test('validateRule rejects short name / empty pattern, accepts + normalizes', () => {
  assert.equal(validateRule({ name: 'x', pattern: 'p' }).ok, false);
  assert.equal(validateRule({ name: 'ok name', pattern: '' }).ok, false);

  const v = validateRule({ name: 'Block Scanners', pattern: 'path starts with /wp-admin' });
  assert.ok(v.ok);
  if (v.ok) {
    assert.equal(v.rule.id, 'block-scanners');
    assert.equal(v.rule.enabled, true);
    assert.equal(v.rule.pattern, 'path starts with /wp-admin');
  }
});

test('validateRule honors explicit id and enabled:false', () => {
  const v = validateRule({ id: 'custom-id', name: 'Some Rule', pattern: 'x', enabled: false });
  assert.ok(v.ok);
  if (v.ok) {
    assert.equal(v.rule.id, 'custom-id');
    assert.equal(v.rule.enabled, false);
  }
});

test('upsertRule adds then edits by id, immutably', () => {
  const base = defaultIntent(FIXED);
  const r1 = { id: 'a', name: 'A', pattern: 'pa', enabled: true };
  const added = upsertRule(base, r1, FIXED);
  assert.equal(added.rules.length, 1);
  assert.notEqual(added, base); // new object
  assert.equal(base.rules.length, 0); // original untouched

  const edited = upsertRule(added, { id: 'a', name: 'A2', pattern: 'pa2', enabled: false }, FIXED);
  assert.equal(edited.rules.length, 1);
  assert.equal(edited.rules[0].name, 'A2');
  assert.equal(edited.rules[0].enabled, false);
});

test('removeRule reports changed + is a no-op for unknown ids', () => {
  const withRule = upsertRule(defaultIntent(FIXED), { id: 'a', name: 'A', pattern: 'p', enabled: true }, FIXED);
  const hit = removeRule(withRule, 'a', FIXED);
  assert.equal(hit.changed, true);
  assert.equal(hit.intent.rules.length, 0);

  const miss = removeRule(withRule, 'nope', FIXED);
  assert.equal(miss.changed, false);
  assert.equal(miss.intent, withRule); // same reference — nothing changed
});

test('setWafEnabled is a no-op when unchanged', () => {
  const i = defaultIntent(FIXED); // wafEnabled true
  assert.equal(setWafEnabled(i, true, FIXED), i);
  const off = setWafEnabled(i, false, FIXED);
  assert.equal(off.wafEnabled, false);
  assert.notEqual(off, i);
});

test('diffIntent: in sync when desired matches live', () => {
  const intent: EdgeIntent = {
    wafEnabled: true,
    rules: [{ id: 'a', name: 'Block A', pattern: 'p', enabled: true }],
    updatedAt: FIXED().toISOString(),
  };
  const d = diffIntent(intent, { wafEnabled: true, liveRuleNames: ['Block A'] });
  assert.equal(d.inSync, true);
  assert.deepEqual(d.pendingRules, []);
  assert.deepEqual(d.removedRules, []);
});

test('diffIntent: pending WAF toggle + pending + removed rules', () => {
  const intent: EdgeIntent = {
    wafEnabled: false, // operator turned it off; live is still on
    rules: [
      { id: 'a', name: 'New Rule', pattern: 'p', enabled: true }, // not live yet → pending
      { id: 'b', name: 'Disarmed', pattern: 'p', enabled: false }, // disabled → not counted
    ],
    updatedAt: FIXED().toISOString(),
  };
  const d = diffIntent(intent, { wafEnabled: true, liveRuleNames: ['Old Rule'] });
  assert.equal(d.inSync, false);
  assert.equal(d.wafPending, true);
  assert.deepEqual(d.pendingRules, ['New Rule']);
  assert.deepEqual(d.removedRules, ['Old Rule']); // live rule no enabled intent accounts for
});
