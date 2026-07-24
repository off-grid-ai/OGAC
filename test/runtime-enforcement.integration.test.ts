import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION tests for the three "built but not enforcing" fixes, against a REAL Postgres:
//   1. an operator-created guardrail RULE actually fires at runtime (runChecks → guardrail-rules);
//   2. PII masking substitutes the raw value BEFORE the model call (the gateway body is masked);
//   3. a simulated DRIFT breach triggers an automatic rollback of a published pipeline.
// Skips (green) when no DB is up. Tracks + deletes only the ids it creates.

const dbUp = await dbReachable();

test('operator guardrail rule fires at runtime (real Postgres)', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { createGuardrailRule, deleteGuardrailRule, validateRule } = await import('@/lib/guardrails-rules');
  const { runChecks, outcomeFromChecks, parseGuardrailMaskedText } = await import('@/lib/checks');

  const orgId = `org-grr-${Date.now()}`;
  // A regex rule the operator authors in the console: redact anything shaped like an Indian PAN.
  const v = validateRule({ matcher: 'regex', pattern: '[A-Z]{5}[0-9]{4}[A-Z]', action: 'redact', label: 'PAN' });
  assert.equal(v.ok, true);
  const created = await createGuardrailRule(v.ok ? v.value : (undefined as never), orgId);
  t.after(async () => {
    await deleteGuardrailRule(created.id, orgId).catch(() => {});
  });

  // Run the PRE checks the way the run path does, with the org threaded (worker path).
  const checks = await runChecks('pre', { phase: 'pre', input: 'my PAN is ABCPE1234F please', orgId });
  const grr = checks.find((c) => c.name === 'guardrail-rules');
  assert.ok(grr, 'the guardrail-rules check ran');
  assert.equal(grr!.verdict, 'redacted', 'the operator rule fired → redacted verdict');
  assert.equal(outcomeFromChecks(checks), 'redacted', 'the run outcome reflects the rule');

  // The masked text is recoverable and no longer contains the raw PAN.
  const masked = parseGuardrailMaskedText(grr!.detail);
  assert.ok(masked, 'masked text carried on the check detail');
  assert.ok(!masked!.includes('ABCPE1234F'), 'the raw PAN is gone from the masked text');
  assert.ok(masked!.includes('[PAN]'), 'the redaction placeholder is present');
});

test('a rule that is DISABLED does not fire (real Postgres)', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { createGuardrailRule, deleteGuardrailRule, setGuardrailRuleEnabled, validateRule } =
    await import('@/lib/guardrails-rules');
  const { runChecks } = await import('@/lib/checks');

  const orgId = `org-grr2-${Date.now()}`;
  const v = validateRule({ matcher: 'regex', pattern: 'topsecret', action: 'redact' });
  const created = await createGuardrailRule(v.ok ? v.value : (undefined as never), orgId);
  t.after(async () => {
    await deleteGuardrailRule(created.id, orgId).catch(() => {});
  });
  await setGuardrailRuleEnabled(created.id, false, orgId);

  const checks = await runChecks('pre', { phase: 'pre', input: 'this is topsecret', orgId });
  const grr = checks.find((c) => c.name === 'guardrail-rules');
  assert.equal(grr!.verdict, 'pass', 'a disabled rule never fires');
});

test('PII masking substitutes the raw value BEFORE the model (real PII scan + contract merge)', async () => {
  // This proves the two halves of the agentrun PA-16c masking, end-to-end, WITHOUT dragging next-auth
  // into the node test runner (importing the full runAgent pulls the request-scope tenancy stack):
  //   (a) the CONTRACT actually resolves requirePiiMasking=true through the real governance merge;
  //   (b) the substitution the run path applies replaces the raw PII with the redacted form — using
  //       the REAL default PII scan (the regex floor) + the REAL pure substitution helper.
  const { enforceModelCall } = await import('@/lib/pipeline-enforcement');
  const { ORG_GUARDRAIL_DEFAULTS, ORG_POLICY_DEFAULTS } = await import('@/lib/pipeline-governance');
  const { normalizeRouting } = await import('@/lib/pipelines-policy');
  const { maskTextForModel } = await import('@/lib/guardrail-rules-runtime');
  const { regexScan } = await import('@/lib/adapters/pii-regex');

  // requirePiiMasking must be an org control for the tightening merge to keep it — seed it as a
  // default and turn it ON via the overlay (the pipeline builder's "require masking" toggle).
  const guardrailDefaults = {
    ...ORG_GUARDRAIL_DEFAULTS,
    requirePiiMasking: { mode: 'default' as const, bool: false },
  };
  const contract = {
    pipelineId: 'pl-mask-test',
    dataAllowlist: [] as string[],
    routing: normalizeRouting(undefined),
    orgPolicyDefaults: ORG_POLICY_DEFAULTS,
    orgGuardrailDefaults: guardrailDefaults,
    policyOverlay: {},
    guardrailOverlay: { requirePiiMasking: { mode: 'default' as const, bool: true } },
  };

  // (a) the contract resolves to "masking required" — the flag the run path branches on.
  const verdict = enforceModelCall(contract as never, 'general');
  assert.equal(verdict.allow, true);
  assert.equal(verdict.requirePiiMasking, true, 'the bound contract requires PII masking');

  // (b) the substitution the run path performs when that flag is set: scan the outbound query with
  // the REAL default detector, then apply the REAL substitution — the raw email must be gone.
  const rawQuery = 'please email me at alice@example.com about the case';
  const scan = regexScan(rawQuery);
  const modelQuery = verdict.requirePiiMasking ? maskTextForModel(rawQuery, scan) : rawQuery;

  assert.notEqual(modelQuery, rawQuery, 'the outbound query was substituted');
  assert.ok(!modelQuery.includes('alice@example.com'), 'the raw email did NOT reach the model');
  assert.ok(modelQuery.includes('[EMAIL]'), 'the redacted placeholder is what the model sees');

  // Control: with masking NOT required, the query is untouched (additive/legacy behaviour).
  const noMask = { ...contract, guardrailOverlay: {} };
  const v2 = enforceModelCall(noMask as never, 'general');
  assert.equal(v2.requirePiiMasking, false);
  const unchanged = v2.requirePiiMasking ? maskTextForModel(rawQuery, scan) : rawQuery;
  assert.equal(unchanged, rawQuery, 'no masking required ⇒ the raw query is unchanged');
});

// ── Egress DLP on the GOVERNED-run path (agentrun) — the per-org policy that only the chat seam used
// to honor now governs app/agent runs too. These compose the REAL functions agentrun invokes, in the
// SAME order, and assert the terminal artifacts (the model-bound query; the block verdict + audit).
// The full runAgent live path is verified on the box (importing runAgent here drags next-auth in).

test('egress DLP ESCALATES masking on a cloud run even when the pipeline overlay is OFF', async () => {
  const { enforceModelCall } = await import('@/lib/pipeline-enforcement');
  const { ORG_GUARDRAIL_DEFAULTS, ORG_POLICY_DEFAULTS } = await import('@/lib/pipeline-governance');
  const { normalizeRouting } = await import('@/lib/pipelines-policy');
  const { maskTextForModel } = await import('@/lib/guardrail-rules-runtime');
  const { regexScan } = await import('@/lib/adapters/pii-regex');
  const { egressDlpRunDemand } = await import('@/lib/egress-dlp');
  const { effectivePiiMasking } = await import('@/lib/pii-escalation');

  // A pipeline whose masking overlay is OFF — the pre-fix state where a cloud run leaked raw PII.
  const contract = {
    pipelineId: 'pl-egress-mask',
    dataAllowlist: [] as string[],
    routing: normalizeRouting(undefined),
    orgPolicyDefaults: ORG_POLICY_DEFAULTS,
    orgGuardrailDefaults: { ...ORG_GUARDRAIL_DEFAULTS, requirePiiMasking: { mode: 'default' as const, bool: false } },
    policyOverlay: {},
    guardrailOverlay: {},
  };
  const verdict = enforceModelCall(contract as never, 'general');
  assert.equal(verdict.requirePiiMasking, false, 'the pipeline overlay does NOT require masking');

  // The org egress-DLP policy (default: enabled, mask) on a CLOUD-permitted run supplies the floor.
  const demand = egressDlpRunDemand('cloud', { enabled: true, strictness: 'mask' });
  assert.equal(demand.maskFloor, true);
  const requireMasking = effectivePiiMasking(demand.maskFloor, verdict);
  assert.equal(requireMasking, true, 'egress DLP escalated masking ON for the cloud run');

  // The substitution the run path then performs — the raw customer PII must not reach the model.
  const rawQuery = 'settle the claim for pan ABCPE1234F and email alice@example.com';
  const modelQuery = requireMasking ? maskTextForModel(rawQuery, regexScan(rawQuery)) : rawQuery;
  assert.ok(!modelQuery.includes('ABCPE1234F'), 'the raw PAN did NOT reach the model');
  assert.ok(!modelQuery.includes('alice@example.com'), 'the raw email did NOT reach the model');
  assert.ok(modelQuery.includes('[PAN]') && modelQuery.includes('[EMAIL]'), 'redacted placeholders sent');

  // Control: the SAME run on a LOCAL route demands nothing — on-prem content is byte-identical.
  const localDemand = egressDlpRunDemand('local', { enabled: true, strictness: 'mask' });
  assert.equal(localDemand.maskFloor, false);
  const localQuery = effectivePiiMasking(localDemand.maskFloor, verdict) ? maskTextForModel(rawQuery, regexScan(rawQuery)) : rawQuery;
  assert.equal(localQuery, rawQuery, 'a local run is never masked by egress DLP');
});

test('egress DLP strictness BLOCK refuses a cloud run whose content carries PII (+ auditable)', async () => {
  const { egressDlpRunDemand, enforceEgressDlp } = await import('@/lib/egress-dlp');
  const { egressScanFromPii, mergeEgressScans } = await import('@/lib/egress-dlp-run');
  const { egressDlpAuditEvent, egressDlpAuditable, EGRESS_DLP_ACTION } = await import('@/lib/egress-dlp-audit');
  const { regexScan } = await import('@/lib/adapters/pii-regex');

  const policy = { enabled: true, strictness: 'block' as const };
  assert.deepEqual(egressDlpRunDemand('cloud', policy), { maskFloor: true, blockOnPii: true });

  // Build the aggregate scan the run path builds from its query + source scans (here: a PAN hit).
  const scan = egressScanFromPii(regexScan('customer pan ABCPE1234F'), 'customer pan ABCPE1234F');
  assert.equal(scan.hits, true, 'the real regex floor detected the PAN');
  const decision = enforceEgressDlp('cloud', '', policy, mergeEgressScans([scan]));

  assert.equal(decision.action, 'blocked', 'strictness block + PII ⇒ the run is REFUSED');
  assert.ok(decision.reason.includes('BLOCKED'));
  assert.equal(egressDlpAuditable(decision), true, 'a blocked egress is audited');
  const ev = egressDlpAuditEvent(
    { actor: { type: 'user', id: 'rm@acme.test', label: 'RM' }, org: 'acme', runId: 'run_x', model: 'openai:gpt-4o' },
    decision,
  );
  assert.equal(ev.action, EGRESS_DLP_ACTION);
  assert.equal(ev.outcome, 'blocked', 'the governance ledger records the blocked egress');
});

test('egress DLP MASK strictness on a clean cloud run passes through, unaudited (no false noise)', async () => {
  const { enforceEgressDlp } = await import('@/lib/egress-dlp');
  const { egressScanFromPii, mergeEgressScans } = await import('@/lib/egress-dlp-run');
  const { egressDlpAuditable } = await import('@/lib/egress-dlp-audit');
  const { regexScan } = await import('@/lib/adapters/pii-regex');

  const clean = egressScanFromPii(regexScan('summarize the quarterly policy for the team'), 'x');
  assert.equal(clean.hits, false);
  const decision = enforceEgressDlp('cloud', '', { enabled: true, strictness: 'mask' }, mergeEgressScans([clean]));
  assert.equal(decision.action, 'passthrough');
  assert.equal(decision.screened, true, 'it WAS screened, just clean');
  assert.equal(egressDlpAuditable(decision), false, 'a clean screened egress is not audit noise');
});

test('a simulated DRIFT breach triggers auto-rollback of a published pipeline (real Postgres)', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { createPipeline, updatePipeline, getPipeline, deletePipeline } = await import('@/lib/pipelines');
  const { publishWithGate } = await import('@/lib/pipeline-release');
  const { autoRollbackOnDrift } = await import('@/lib/auto-rollback');

  const orgId = `org-drift-${Date.now()}`;
  const p = await createPipeline({ name: `drift ${Date.now()}`, dataAllowlist: ['good-domain'] }, 'tester', orgId);
  t.after(async () => {
    await deletePipeline(p.id, orgId).catch(() => {});
  });

  // Publish → freezes a good published snapshot (no evals ⇒ ungated pass).
  const pub = await publishWithGate(p.id, { orgId, by: 'tester@offgrid.local' });
  assert.equal(pub!.pipeline?.status, 'published');

  // A bad edit changes the live config away from the good published one.
  await updatePipeline(p.id, { dataAllowlist: ['BAD-domain'] }, orgId, 'tester@offgrid.local');
  const beforeRollback = await getPipeline(p.id, orgId);
  assert.deepEqual(beforeRollback!.dataAllowlist, ['BAD-domain']);

  // Simulate a drift BREACH → auto-rollback fires and reverts the published pipeline to last-good.
  const summary = await autoRollbackOnDrift('drift', { orgId, by: 'system@offgrid.local' });
  assert.equal(summary.fired, true, 'auto-rollback fired on the drift breach');
  assert.equal(summary.reason, 'drift-breach');
  assert.ok(summary.rolledBack >= 1, 'at least the published pipeline was rolled back');

  const afterRollback = await getPipeline(p.id, orgId);
  assert.deepEqual(afterRollback!.dataAllowlist, ['good-domain'], 'reverted to the last-good config');
  assert.equal(afterRollback!.status, 'published');

  // A drift WARNING (not a breach) does NOT fire.
  const noFire = await autoRollbackOnDrift('warning', { orgId });
  assert.equal(noFire.fired, false);
});
