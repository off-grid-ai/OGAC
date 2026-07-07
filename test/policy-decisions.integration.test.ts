import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test: every enforcement decision that flows through the policy port must be mirrored
// into the first-party decision log, so /api/v1/admin/policy/decisions shows a REAL history even
// when OPA's external decision-log sink (OFFGRID_OPA_DECISION_LOG_URL) is unset — the exact live
// gap. Exercises the real firstPartyPolicy.evaluate → recordDecision → readDecisions chain against
// a real Postgres (evaluateAbac reads abac_rules). Skips green if the DB is down.

const dbUp = await dbReachable();

test('policy port records decisions that readDecisions surfaces', { skip: dbUp ? false : SKIP_MESSAGE }, async () => {
  const { firstPartyPolicy } = await import('@/lib/adapters/policy');
  const { _resetDecisionLog } = await import('@/lib/policy-decision-log');
  const { readDecisions } = await import('@/lib/policy-view');

  // Ensure OPA sink is unset for this test so readDecisions uses the local log fallback.
  const prev = process.env.OFFGRID_OPA_DECISION_LOG_URL;
  delete process.env.OFFGRID_OPA_DECISION_LOG_URL;
  _resetDecisionLog();

  try {
    // A real evaluation through the port (default-deny when no rule matches this synthetic input).
    const decision = await firstPartyPolicy.evaluate({
      role: 'test-analyst',
      resource: 'test-secrets',
      attributes: { clearance: 'low' },
    });
    assert.equal(typeof decision.allow, 'boolean');
    assert.equal(decision.engine, 'abac');

    const rows = await readDecisions();
    assert.ok(rows.length >= 1, 'the evaluation must appear in the decision read-back');
    const latest = rows[0];
    assert.equal(latest.engine, 'abac');
    assert.equal(latest.allow, decision.allow);
    assert.match(latest.input, /role=test-analyst/);
    assert.match(latest.input, /resource=test-secrets/);
    assert.match(latest.path, /test-secrets/);
  } finally {
    _resetDecisionLog();
    if (prev !== undefined) process.env.OFFGRID_OPA_DECISION_LOG_URL = prev;
  }
});
