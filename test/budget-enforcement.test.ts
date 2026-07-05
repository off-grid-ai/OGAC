import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkBudget, costForTokens, priceFor } from '@/lib/finops';
import { envEnforceState } from '@/lib/budget-config';

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
