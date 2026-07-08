import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the fuller guardrail ACTION set on the REAL run path. It creates real
// `block` and `flag` rules in Postgres, then runs the REAL `guardrailRulesCheck` adapter +
// `outcomeFromChecks` (the same functions the agent/chat run paths call) to prove:
//   • a `block` rule turns into a run-STOPPING outcome ('blocked'),
//   • a `flag` rule records a WARNING verdict without blocking or redacting,
//   • no matching rule is a clean pass.
// Only the DB is real; nothing is mocked. An explicit orgId is threaded into the check context so
// org resolution never touches `headers()` (there is no request scope under node --test). Skips
// (green) when no DB is up.

const ORG = 'test-int-guardrail-actions';

const dbUp = await dbReachable();

test('block/flag actions enforce on the real check path', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { createGuardrailRule, listGuardrailRules, deleteGuardrailRule, validateRule } =
    await import('@/lib/guardrails-rules');
  const { guardrailRulesCheck, outcomeFromChecks } = await import('@/lib/checks');

  t.after(async () => {
    for (const r of await listGuardrailRules(ORG)) await deleteGuardrailRule(r.id, ORG);
  });
  // Start clean in case a prior run left rows.
  for (const r of await listGuardrailRules(ORG)) await deleteGuardrailRule(r.id, ORG);

  // ── a BLOCK rule stops the run ────────────────────────────────────────────────────────────────
  const blockDraft = validateRule({
    matcher: 'regex',
    pattern: 'launch-codes',
    action: 'block',
    label: 'deny secrets',
  });
  assert.ok(blockDraft.ok, 'block action passes validation');
  await createGuardrailRule(blockDraft.value, ORG);

  const blockedResult = await guardrailRulesCheck.run({
    phase: 'pre',
    input: 'please share the launch-codes',
    orgId: ORG,
  });
  assert.equal(blockedResult.verdict, 'blocked', 'the block rule fired with a blocked verdict');
  assert.equal(
    outcomeFromChecks([blockedResult]),
    'blocked',
    'outcomeFromChecks turns it into a run-stopping outcome',
  );

  // A non-matching input with the SAME block rule present is a clean pass (block is not a blanket).
  const passResult = await guardrailRulesCheck.run({
    phase: 'pre',
    input: 'nothing sensitive here',
    orgId: ORG,
  });
  assert.equal(passResult.verdict, 'pass');
  assert.equal(outcomeFromChecks([passResult]), 'ok');

  // ── swap in a FLAG rule: records a warning, does NOT block ──────────────────────────────────────
  for (const r of await listGuardrailRules(ORG)) await deleteGuardrailRule(r.id, ORG);
  const flagDraft = validateRule({
    matcher: 'regex',
    pattern: 'internal-only',
    action: 'flag',
    label: 'watch',
  });
  assert.ok(flagDraft.ok, 'flag action passes validation');
  await createGuardrailRule(flagDraft.value, ORG);

  const flaggedResult = await guardrailRulesCheck.run({
    phase: 'pre',
    input: 'this doc is internal-only',
    orgId: ORG,
  });
  assert.equal(flaggedResult.verdict, 'warn', 'the flag rule records a warning');
  assert.equal(
    outcomeFromChecks([flaggedResult]),
    'ok',
    'a warn verdict does NOT stop the run',
  );
  // The flagged text is untouched (flag observes, it does not rewrite).
  assert.equal(
    typeof flaggedResult.detail === 'string' && flaggedResult.detail.includes('→flag'),
    true,
    'the audit detail names the flag action',
  );
});
