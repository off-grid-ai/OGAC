import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SOURCE_FIDELITY_RULE, withSourceFidelityRule } from '../src/lib/agent-prompt-rules.ts';

// ── G-UX5 — the agent must not invent a currency ────────────────────────────────────────────────────
//
// Live run apprun_76864dd2 reported "$41,346.44" for an Indian BFSI tenant. The source column is a bare
// decimal; the model supplied the symbol because nothing told it not to. The console already decided this
// (app-work-queue.ts:209 — "guessing one would be a lie"); the agent was simply never told.

describe('withSourceFidelityRule', () => {
  test('appends the rule while keeping the authored instruction first', () => {
    const authored = "Determine if the claim exceeds the employee's remaining quota.";
    const out = withSourceFidelityRule(authored);
    assert.ok(out.startsWith(authored), out);
    assert.ok(out.includes(SOURCE_FIDELITY_RULE));
  });

  test('the rule actually forbids inventing a currency, and estimating', () => {
    assert.match(SOURCE_FIDELITY_RULE, /Do not add a currency symbol/);
    assert.match(SOURCE_FIDELITY_RULE, /say so plainly rather than estimating/);
  });

  test('is idempotent — recompiling an app cannot stack the rule up', () => {
    const once = withSourceFidelityRule('Decide.');
    assert.equal(withSourceFidelityRule(once), once);
    assert.equal(once.split('Do not add a currency symbol').length - 1, 1);
  });

  test('an empty prompt stays empty — the caller owns its own fallback', () => {
    assert.equal(withSourceFidelityRule(''), '');
    assert.equal(withSourceFidelityRule('   '), '');
  });

  test('trims the authored prompt rather than welding the rule onto trailing space', () => {
    assert.ok(withSourceFidelityRule('  Decide.  ').startsWith('Decide.\n\n'));
  });
});
