import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkBudget, costForTokens, priceFor } from '@/lib/finops';
import { envEnforceState, orgEnforceFlagKey, resolveEnforce } from '@/lib/budget-config';

// Pure budget-ENFORCEMENT logic (Phase 0 Tier-0 gap). No I/O, no mocks — real functions, real
// assertions. `checkBudget` is the single decision the chat + agent spend gates call; these lock
// its exhaustive behavior (under / at / over / no-limit / zero-limit / zero-cost).

test('checkBudget: no limit set → always allow (unlimited)', () => {
  const d = checkBudget(9999, null, 5);
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'no-limit');
  assert.equal(d.limit, null);
});

test('checkBudget: under budget → allow (within-budget)', () => {
  const d = checkBudget(10, 100, 5); // 10 + 5 = 15 <= 100
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'within-budget');
});

test('checkBudget: exactly AT the budget after this call → allow (boundary is inclusive)', () => {
  const d = checkBudget(95, 100, 5); // 95 + 5 = 100, not > 100
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'within-budget');
});

test('checkBudget: OVER budget → deny (over-budget) with the numbers', () => {
  const d = checkBudget(98, 100, 5); // 98 + 5 = 103 > 100
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'over-budget');
  assert.equal(d.spent, 98);
  assert.equal(d.limit, 100);
  assert.equal(d.incomingCost, 5);
});

test('checkBudget: already spent-out, any real cost → deny', () => {
  const d = checkBudget(100, 100, 0.001);
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'over-budget');
});

test('checkBudget: zero-limit budget denies the first REAL-cost call', () => {
  const d = checkBudget(0, 0, 0.5);
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'over-budget');
});

test('checkBudget: zero-cost (local / on-prem $0) call NEVER exceeds — even at a zero limit', () => {
  assert.equal(checkBudget(0, 0, 0).allow, true);
  assert.equal(checkBudget(0, 0, 0).reason, 'zero-cost');
  // even fully spent out, a free local call is admitted (the on-device dividend)
  assert.equal(checkBudget(100, 100, 0).allow, true);
  assert.equal(checkBudget(100, 100, 0).reason, 'zero-cost');
});

test('checkBudget: negative / non-finite inputs are clamped, never crash', () => {
  assert.equal(checkBudget(-5, 100, -1).allow, true); // negative cost → treated as 0 → zero-cost
  assert.equal(checkBudget(-5, 100, -1).reason, 'zero-cost');
  assert.equal(checkBudget(Number.NaN, 100, Number.NaN).reason, 'zero-cost');
  // a finite over-budget with a clamped negative spent still denies on the real cost
  const d = checkBudget(-5, 10, 20);
  assert.equal(d.allow, false);
  assert.equal(d.spent, 0);
});

test('checkBudget agrees with finops pricing: local model cost is $0 → never blocks', () => {
  // gemma-local is priced at $0/1k in finops → a huge local call still costs nothing → allowed
  const localCost = costForTokens('gemma-local', 1_000_000);
  assert.equal(localCost, 0);
  assert.equal(priceFor('gemma-local'), 0);
  assert.equal(checkBudget(100, 100, localCost).allow, true);
});

test('checkBudget agrees with finops pricing: cloud model cost is metered and can deny', () => {
  const cloudCost = costForTokens('gpt-4o', 1_000_000); // 1M tokens * $0.005/1k = $5
  assert.equal(cloudCost, 5);
  // budget of $4, nothing spent → this $5 call is denied
  assert.equal(checkBudget(0, 4, cloudCost).allow, false);
  // budget of $10 → allowed
  assert.equal(checkBudget(0, 10, cloudCost).allow, true);
});

// ─── The enforce flag's pure env resolution (budget-config) ──────────────────────
test('envEnforceState: unset / empty → defer to the flag store (default ON)', () => {
  assert.equal(envEnforceState(undefined), 'unset');
  assert.equal(envEnforceState(''), 'unset');
  assert.equal(envEnforceState('  '), 'unset');
});

test('envEnforceState: explicit disable values → off', () => {
  for (const v of ['false', '0', 'no', 'off', 'FALSE', 'Off']) {
    assert.equal(envEnforceState(v), 'off', v);
  }
});

test('envEnforceState: explicit enable values → on', () => {
  for (const v of ['true', '1', 'yes', 'on', 'TRUE', 'On']) {
    assert.equal(envEnforceState(v), 'on', v);
  }
});

test('envEnforceState: unrecognized value defers (fails toward the safe default)', () => {
  assert.equal(envEnforceState('maybe'), 'unset');
});

// ─── Per-org enforce key (GAP #33) ───────────────────────────────────────────────
test('orgEnforceFlagKey: a real org → a per-org flag key namespaced under the global flag', () => {
  assert.equal(orgEnforceFlagKey('acme'), 'budget.enforce:acme');
  assert.equal(orgEnforceFlagKey('  acme  '), 'budget.enforce:acme'); // trimmed
});

test('orgEnforceFlagKey: blank / undefined org → null (no per-org scope → use global)', () => {
  assert.equal(orgEnforceFlagKey(undefined), null);
  assert.equal(orgEnforceFlagKey(''), null);
  assert.equal(orgEnforceFlagKey('   '), null);
});

// ─── Pure org-scoped enforce resolution (GAP #33) ────────────────────────────────
// resolveEnforce(env, orgOverride, globalFlag): precedence env → per-org override → global flag.
test('resolveEnforce: env kill-switch wins over everything (both directions)', () => {
  // env=off beats a per-org ON and a global ON
  assert.equal(resolveEnforce('off', true, true), false);
  // env=on beats a per-org OFF and a global OFF
  assert.equal(resolveEnforce('on', false, false), true);
});

test('resolveEnforce: per-org override applied when env is unset (overrides the global default)', () => {
  // org turned OFF while the deployment default is ON → this org is exempt
  assert.equal(resolveEnforce('unset', false, true), false);
  // org turned ON while the deployment default is OFF → this org is enforced
  assert.equal(resolveEnforce('unset', true, false), true);
});

test('resolveEnforce: no per-org override (undefined) → falls back to the global flag', () => {
  assert.equal(resolveEnforce('unset', undefined, true), true);
  assert.equal(resolveEnforce('unset', undefined, false), false);
});

test('resolveEnforce: default ON — env unset, no per-org override, global defaults ON', () => {
  // This is the out-of-the-box posture: enforcement holds by default, not by opt-in.
  assert.equal(resolveEnforce('unset', undefined, true), true);
});

test('resolveEnforce: backward compatible — with no per-org override, result == old env→global behavior', () => {
  // For every combination of env tri-state and global flag, dropping the per-org override
  // (undefined) must reproduce exactly the pre-GAP-33 behavior: env if set, else the global flag.
  for (const env of ['on', 'off', 'unset'] as const) {
    for (const global of [true, false]) {
      const expected = env === 'unset' ? global : env === 'on';
      assert.equal(resolveEnforce(env, undefined, global), expected, `${env}/${global}`);
    }
  }
});
