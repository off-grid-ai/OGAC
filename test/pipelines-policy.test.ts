import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canReachData,
  deriveEgress,
  effectiveGovernance,
  nextVersion,
  normalizeAllowlist,
  normalizeRouting,
  snapshotOf,
  validatePipelineCreate,
  validatePipelineUpdate,
  type GovernanceControls,
  type PipelineShape,
} from '../src/lib/pipelines-policy.ts';
import { planSeedPipelines, samplePipelineId, seedPipelineNeedsUpdate } from '../src/lib/pipelines-seed.ts';

// ─── validation ────────────────────────────────────────────────────────────────────────────────────

test('validatePipelineCreate: name is required', () => {
  assert.equal(validatePipelineCreate({ name: '' }).ok, false);
  assert.equal(validatePipelineCreate({}).ok, false);
  assert.equal(validatePipelineCreate({ name: '  ' }).ok, false);
  assert.equal(validatePipelineCreate({ name: 'Reimbursement Governance' }).ok, true);
});

test('validatePipelineCreate: status + visibility must be in their sets when present', () => {
  assert.equal(validatePipelineCreate({ name: 'x', status: 'nonsense' }).ok, false);
  assert.equal(validatePipelineCreate({ name: 'x', status: 'published' }).ok, true);
  assert.equal(validatePipelineCreate({ name: 'x', visibility: 'galaxy' }).ok, false);
  assert.equal(validatePipelineCreate({ name: 'x', visibility: 'org' }).ok, true);
});

test('validatePipelineUpdate: name may be omitted but not blanked', () => {
  assert.equal(validatePipelineUpdate({}).ok, true);
  assert.equal(validatePipelineUpdate({ description: 'new' }).ok, true);
  assert.equal(validatePipelineUpdate({ name: '' }).ok, false);
  assert.equal(validatePipelineUpdate({ name: 'ok' }).ok, true);
});

// ─── canReachData — the HARD ceiling ────────────────────────────────────────────────────────────────

test('canReachData: only ids inside the allowlist are reachable; empty = deny-by-default', () => {
  assert.equal(canReachData(['kyc-records', 'customer-master'], 'kyc-records'), true);
  assert.equal(canReachData(['kyc-records'], 'transactions'), false, 'outside the ceiling ⇒ denied');
  assert.equal(canReachData([], 'anything'), false, 'empty allowlist reaches nothing');
  assert.equal(canReachData(['kyc-records'], ''), false, 'no requested domain ⇒ denied');
});

// ─── effectiveGovernance — mandatory-locked merge ────────────────────────────────────────────────────

test('effectiveGovernance: a default control is freely overridable', () => {
  const org: GovernanceControls = { maskPii: { mode: 'default', bool: false } };
  const overlay: GovernanceControls = { maskPii: { mode: 'default', bool: true } };
  const eff = effectiveGovernance(org, overlay);
  assert.equal(eff.controls.maskPii.bool, true);
  assert.equal(eff.controls.maskPii.overridden, true);
  assert.deepEqual(eff.rejected, []);
});

test('effectiveGovernance: a locked bool control CAN be tightened (off → on)', () => {
  const org: GovernanceControls = { maskPii: { mode: 'locked', bool: false } };
  const overlay: GovernanceControls = { maskPii: { mode: 'locked', bool: true } };
  const eff = effectiveGovernance(org, overlay);
  assert.equal(eff.controls.maskPii.bool, true, 'tighten to on is honoured');
  assert.equal(eff.controls.maskPii.loosenRejected, false);
  assert.equal(eff.controls.maskPii.overridden, true);
});

test('effectiveGovernance: a locked bool control CANNOT be loosened (on → off is rejected)', () => {
  const org: GovernanceControls = { maskPii: { mode: 'locked', bool: true } };
  const overlay: GovernanceControls = { maskPii: { mode: 'locked', bool: false } };
  const eff = effectiveGovernance(org, overlay);
  assert.equal(eff.controls.maskPii.bool, true, 'the org value stands');
  assert.equal(eff.controls.maskPii.loosenRejected, true);
  assert.equal(eff.controls.maskPii.overridden, false);
  assert.deepEqual(eff.rejected, ['maskPii']);
});

test('effectiveGovernance: a locked LEVEL control can be tightened (cloud → local)', () => {
  const org: GovernanceControls = { maxEgress: { mode: 'locked', level: 'cloud' } };
  const overlay: GovernanceControls = { maxEgress: { mode: 'locked', level: 'local' } };
  const eff = effectiveGovernance(org, overlay);
  assert.equal(eff.controls.maxEgress.level, 'local', 'stricter level is honoured');
  assert.equal(eff.controls.maxEgress.overridden, true);
  assert.equal(eff.controls.maxEgress.loosenRejected, false);
});

test('effectiveGovernance: a locked LEVEL control CANNOT be loosened (local → cloud is rejected)', () => {
  const org: GovernanceControls = { maxEgress: { mode: 'locked', level: 'local' } };
  const overlay: GovernanceControls = { maxEgress: { mode: 'locked', level: 'cloud' } };
  const eff = effectiveGovernance(org, overlay);
  assert.equal(eff.controls.maxEgress.level, 'local', 'the locked ceiling stands');
  assert.equal(eff.controls.maxEgress.loosenRejected, true);
  assert.deepEqual(eff.rejected, ['maxEgress']);
});

test('effectiveGovernance: a locked LEVEL to the strictest end (block) is honoured', () => {
  const org: GovernanceControls = { maxEgress: { mode: 'locked', level: 'local' } };
  const overlay: GovernanceControls = { maxEgress: { mode: 'locked', level: 'block' } };
  const eff = effectiveGovernance(org, overlay);
  assert.equal(eff.controls.maxEgress.level, 'block');
  assert.equal(eff.controls.maxEgress.loosenRejected, false);
});

test('effectiveGovernance: overlay keys the org never defined are ignored', () => {
  const org: GovernanceControls = { maskPii: { mode: 'default', bool: true } };
  const overlay: GovernanceControls = { inventedControl: { mode: 'default', bool: false } };
  const eff = effectiveGovernance(org, overlay);
  assert.ok(!('inventedControl' in eff.controls), 'a pipeline cannot invent controls');
  assert.equal(eff.controls.maskPii.bool, true);
});

test('effectiveGovernance: a default LEVEL control is overridable in EITHER direction', () => {
  const org: GovernanceControls = { maxEgress: { mode: 'default', level: 'local' } };
  const loosened = effectiveGovernance(org, { maxEgress: { mode: 'default', level: 'cloud' } });
  assert.equal(loosened.controls.maxEgress.level, 'cloud', 'default controls may loosen');
  assert.deepEqual(loosened.rejected, []);
});

// ─── deriveEgress — delegates to the pure routing rule ───────────────────────────────────────────────

test('deriveEgress: pii → local under a BFSI leash', () => {
  const routing = normalizeRouting({
    egressAllowed: false,
    rules: [
      { name: 'pii-local', priority: 10, attribute: 'data_class', operator: 'eq', value: 'pii', action: 'local', model: '', fallback: '', enabled: true },
    ],
  });
  const d = deriveEgress(routing, 'pii');
  assert.equal(d.effective, 'local');
  assert.equal(d.matched, 'pii-local');
});

test('deriveEgress: a cloud rule is leashed to block when egress is off', () => {
  const routing = normalizeRouting({
    egressAllowed: false,
    rules: [
      { name: 'public-cloud', priority: 10, attribute: 'data_class', operator: 'eq', value: 'public', action: 'cloud', model: '', fallback: '', enabled: true },
    ],
  });
  const d = deriveEgress(routing, 'public');
  assert.equal(d.action, 'cloud');
  assert.equal(d.effective, 'block', 'egress off ⇒ cloud leashed to block');
});

test('deriveEgress: no rules defaults to local', () => {
  assert.equal(deriveEgress({}, 'whatever').effective, 'local');
});

// ─── normalisers ─────────────────────────────────────────────────────────────────────────────────────

test('normalizeAllowlist: trims, drops empties + non-strings, de-dupes', () => {
  assert.deepEqual(normalizeAllowlist([' a ', 'a', '', 'b', 42, null]), ['a', 'b']);
  assert.deepEqual(normalizeAllowlist('not an array'), []);
});

test('normalizeRouting: coerces a malformed envelope safely', () => {
  assert.deepEqual(normalizeRouting(null), {});
  assert.deepEqual(normalizeRouting({ egressAllowed: 'yes' }), {}, 'non-boolean egress dropped');
  const r = normalizeRouting({ rules: [{ name: 'r', action: 'cloud' }] });
  assert.equal(r.rules?.[0].name, 'r');
  assert.equal(r.rules?.[0].action, 'cloud');
  assert.equal(r.rules?.[0].enabled, true, 'enabled defaults to true');
});

// ─── snapshot + version ──────────────────────────────────────────────────────────────────────────────

const SHAPE: PipelineShape = {
  id: 'pl_1',
  orgId: 'default',
  ownerId: 'me@x.io',
  name: 'KYC Verification',
  description: 'desc',
  visibility: 'private',
  gatewayId: 'gw_1',
  defaultModel: 'llama',
  routing: { egressAllowed: false, rules: [] },
  dataAllowlist: ['kyc-records', 'kyc-records', 'customer-master'],
  policyOverlay: { a: 1 },
  guardrailOverlay: { b: 2 },
  status: 'published',
  version: 3,
  isTemplate: true,
};

test('snapshotOf: freezes the governance-relevant config, de-duping the allowlist', () => {
  const snap = snapshotOf(SHAPE);
  assert.equal(snap.name, 'KYC Verification');
  assert.equal(snap.version, 3);
  assert.equal(snap.gatewayId, 'gw_1');
  assert.equal(snap.status, 'published');
  assert.deepEqual(snap.dataAllowlist, ['kyc-records', 'customer-master']);
  // No id / timestamps leak into the snapshot (replayable).
  assert.ok(!('id' in snap));
  assert.ok(!('createdAt' in snap));
});

test('nextVersion: increments; guards a bad current', () => {
  assert.equal(nextVersion(1), 2);
  assert.equal(nextVersion(9), 10);
  assert.equal(nextVersion(0), 2);
  assert.equal(nextVersion(NaN), 2);
});

// ─── seed: stable ids + org isolation ─────────────────────────────────────────────────────────────────

test('planSeedPipelines: stable, org-scoped ids; BFSI templates bound to the on-prem gateway', () => {
  const def = planSeedPipelines('default');
  assert.equal(def.length, 9);
  assert.ok(def.every((p) => p.isTemplate), 'all are templates');
  assert.ok(def.every((p) => p.status === 'published'), 'templates are published');
  assert.equal(def[0].id, samplePipelineId('default', SAMPLE_KEY_OF(def[0].name)));
  // Bound to that org's seeded on-prem gateway.
  assert.ok(def.every((p) => p.gatewayId === 'gw_seed_default_onprem-cluster'));
  assert.ok(def.every((p) => p.dataAllowlist.length > 0), 'each declares a hard ceiling');

  const bharat = planSeedPipelines('org_bharat');
  assert.ok(bharat.every((p) => p.gatewayId === 'gw_seed_org_bharat_onprem-cluster'));
  assert.deepEqual(
    bharat.find((pipeline) => pipeline.name === 'Cross-Sell Advisor')?.dataAllowlist,
    ['customer data', 'pricing rate card'],
    'cross-sell references both canonical evidence domains, not imaginary tables',
  );
  assert.deepEqual(
    bharat.find((pipeline) => pipeline.name === 'RM cross-sell')?.dataAllowlist,
    ['customer data', 'pricing rate card'],
    'the flagship RM pipeline permits the same governed evidence pair',
  );
  // Org isolation: ids never collide across orgs.
  const defIds = new Set(def.map((p) => p.id));
  assert.ok(bharat.every((p) => !defIds.has(p.id)), 'ids are org-scoped, never shared');
});

test('planSeedPipelines: is deterministic (idempotent re-seed)', () => {
  assert.deepEqual(planSeedPipelines('default'), planSeedPipelines('default'));
});

test('seedPipelineNeedsUpdate: reconciles stale contracts without rewriting identical seeds', () => {
  const desired = planSeedPipelines('org_bharat').find((p) => p.name === 'RM cross-sell');
  assert.ok(desired);
  assert.equal(seedPipelineNeedsUpdate(desired, desired), false);
  assert.equal(
    seedPipelineNeedsUpdate({ ...desired, dataAllowlist: ['customer data'] }, desired),
    true,
  );
});

// gap PA-13 — a fresh seed must be CLEAN: it declares pipeline TEMPLATES only and carries NO API-key
// material, so re-seeding can never (re)introduce the revoked "audit-test-key" rows a live audit
// left behind. (Those lingering rows are runtime pipeline_api_keys records, purged via the revoke/DB
// path — never emitted by this planner.) Lock that the seed plan has no key-bearing fields.
test('planSeedPipelines: a fresh seed carries NO api-key material (PA-13 — clean re-seed)', () => {
  for (const org of ['default', 'org_bharat']) {
    for (const p of planSeedPipelines(org)) {
      const keys = Object.keys(p);
      assert.ok(
        !keys.some((k) => /key|token|secret|revoke/i.test(k)),
        `seed plan for ${p.name} declares no api-key/token/secret/revoke field`,
      );
      const blob = JSON.stringify(p);
      assert.ok(!/audit-test-key/i.test(blob), 'no revoked audit-test-key artifact in the seed');
      assert.ok(!/"revoked"|revokedAt/i.test(blob), 'no revoked-key state in the seed');
    }
  }
});

// helper: recover the key from a template name (mirrors the seed's key→name mapping loosely)
function SAMPLE_KEY_OF(name: string): string {
  const map: Record<string, string> = {
    'Reimbursement Governance': 'reimbursement-governance',
    'Motor-Claim FNOL': 'motor-claim-fnol',
    'Loan Underwriting': 'loan-underwriting',
    'KYC Verification': 'kyc-verification',
    'Fraud Screening': 'fraud-screening',
    'Cross-Sell Advisor': 'cross-sell-advisor',
    'Collections intervention': 'collections-intervention',
    'Indemnity claims': 'indemnity-claims',
    'RM cross-sell': 'rm-cross-sell',
  };
  return map[name] ?? name;
}
