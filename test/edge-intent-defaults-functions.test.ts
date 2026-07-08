import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultIntent,
  removeRule,
  setWafEnabled,
  upsertRule,
  validateRule,
  type WafRule,
} from '@/lib/edge-intent';

// The edge-intent mutators default their clock to `() => new Date()`. The existing suite always
// injects a fixed clock, so those default closures were never exercised. Here we call each with NO
// clock argument to drive the default path, asserting the real (fresh-timestamp) behavior — the
// updatedAt must be a valid, recent ISO string and the state transitions must still hold.

const isoWithinLastMinute = (s: string) => {
  const t = Date.parse(s);
  assert.ok(!Number.isNaN(t), `expected a valid ISO timestamp, got ${s}`);
  assert.ok(Math.abs(Date.now() - t) < 60_000, `expected a recent timestamp, got ${s}`);
};

test('defaultIntent: with the default clock, WAF on, no rules, fresh timestamp', () => {
  const i = defaultIntent();
  assert.equal(i.wafEnabled, true);
  assert.deepEqual(i.rules, []);
  isoWithinLastMinute(i.updatedAt);
});

test('upsertRule + removeRule + setWafEnabled: default clock stamps a fresh updatedAt', () => {
  const rule: WafRule = { id: 'r1', name: 'Rule One', pattern: '/x', enabled: true };
  const added = upsertRule(defaultIntent(), rule); // default clock
  assert.equal(added.rules.length, 1);
  isoWithinLastMinute(added.updatedAt);

  const off = setWafEnabled(added, false); // default clock, real change
  assert.equal(off.wafEnabled, false);
  isoWithinLastMinute(off.updatedAt);

  const { intent: removed, changed } = removeRule(off, 'r1'); // default clock
  assert.equal(changed, true);
  assert.equal(removed.rules.length, 0);
  isoWithinLastMinute(removed.updatedAt);
});

test('validateRule: derives an id from the name via the internal slugifier', () => {
  const v = validateRule({ name: 'Block WP Admin', pattern: 'path /wp-admin' });
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.rule.id, 'block-wp-admin');
});
