import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type PipelineContract,
  enforceDataAccess,
  enforceModelCall,
  enforcementResource,
} from '@/lib/pipeline-enforcement';
import { ORG_GUARDRAIL_DEFAULTS, ORG_POLICY_DEFAULTS } from '@/lib/pipeline-governance';
import type { GovernanceControls } from '@/lib/pipelines-policy';

// A contract builder — the org defaults are the seeded baseline; overlays default to empty (so the
// contract inherits the org locked ceilings: maxEgress=local, requirePurpose=on, requirePiiMasking=on).
function contract(over: Partial<PipelineContract> = {}): PipelineContract {
  return {
    pipelineId: 'pl_test',
    dataAllowlist: [],
    routing: {},
    orgPolicyDefaults: ORG_POLICY_DEFAULTS,
    orgGuardrailDefaults: ORG_GUARDRAIL_DEFAULTS,
    policyOverlay: {},
    guardrailOverlay: {},
    ...over,
  };
}

// ─── enforceDataAccess — the HARD allowlist ceiling ─────────────────────────────────────────────────

test('data access: request INSIDE the allowlist is allowed', () => {
  const v = enforceDataAccess(contract({ dataAllowlist: ['dom_inv', 'dom_hr'] }), 'dom_inv');
  assert.equal(v.allow, true);
  assert.equal(v.noPipeline, false);
});

test('data access: request OUTSIDE the allowlist is DENIED (hard ceiling)', () => {
  const v = enforceDataAccess(contract({ dataAllowlist: ['dom_inv'] }), 'dom_secret');
  assert.equal(v.allow, false);
  assert.match(v.reason, /OUTSIDE the pipeline data allowlist/);
});

test('data access: empty allowlist denies everything (deny-by-default)', () => {
  const v = enforceDataAccess(contract({ dataAllowlist: [] }), 'dom_inv');
  assert.equal(v.allow, false);
});

test('data access: empty request id is denied (nothing to authorize)', () => {
  const v = enforceDataAccess(contract({ dataAllowlist: ['dom_inv'] }), '   ');
  assert.equal(v.allow, false);
});

test('data access: NO pipeline ⇒ allowed (legacy fallback, additive-only)', () => {
  const v = enforceDataAccess(null, 'dom_anything');
  assert.equal(v.allow, true);
  assert.equal(v.noPipeline, true);
});

// ─── enforceModelCall — egress leash + policy/guardrail overlay ─────────────────────────────────────

test('model call: default routing (no rules) → local, forceLocal true, purpose+masking required', () => {
  // No routing rules ⇒ decideRouting defaults to 'local'. Org locked maxEgress=local doesn't demote it.
  const v = enforceModelCall(contract(), 'general');
  assert.equal(v.allow, true);
  assert.equal(v.egress, 'local');
  assert.equal(v.forceLocal, true);
  assert.equal(v.requirePurpose, true); // org-locked requirePurpose
  assert.equal(v.requirePiiMasking, true); // org-locked requirePiiMasking
  assert.equal(v.blockPromptInjection, true); // org-locked blockPromptInjection
});

test('model call: a cloud routing rule is DEMOTED to local by the org maxEgress=local ceiling', () => {
  // Even though egress is allowed AND a rule sends 'cloud', the locked org ceiling (local) tightens it.
  const v = enforceModelCall(
    contract({
      routing: {
        egressAllowed: true,
        rules: [
          {
            name: 'cloud-for-general',
            priority: 10,
            attribute: 'data_class',
            operator: 'eq',
            value: 'general',
            action: 'cloud',
            model: 'gpt-4o',
            fallback: '',
            enabled: true,
          },
        ],
      },
    }),
    'general',
  );
  assert.equal(v.egress, 'local');
  assert.equal(v.forceLocal, true);
  assert.equal(v.allow, true);
});

test('model call: egressAllowed=false leashes a cloud rule to BLOCK (denied)', () => {
  const v = enforceModelCall(
    contract({
      // Loosen the org ceiling to cloud so the leash (not the ceiling) is the thing under test. A
      // `default`-mode override is honoured; but maxEgress is org-LOCKED, so we instead prove the
      // routing leash independently by matching a cloud rule with egress OFF → block.
      routing: {
        egressAllowed: false,
        rules: [
          {
            name: 'cloud-pii',
            priority: 10,
            attribute: 'data_class',
            operator: 'eq',
            value: 'pii',
            action: 'cloud',
            model: 'gpt-4o',
            fallback: '',
            enabled: true,
          },
        ],
      },
    }),
    'pii',
  );
  assert.equal(v.egress, 'block');
  assert.equal(v.allow, false);
  assert.match(v.reason, /blocked/);
});

test('model call: a pipeline can only TIGHTEN — a cloud overlay on locked maxEgress is ignored', () => {
  // The overlay tries to loosen maxEgress to 'cloud'. effectiveGovernance rejects the loosen, so the
  // effective ceiling stays 'local' and a cloud rule is still demoted to local.
  const looseOverlay: GovernanceControls = { maxEgress: { mode: 'default', level: 'cloud' } };
  const v = enforceModelCall(
    contract({
      policyOverlay: looseOverlay,
      routing: {
        egressAllowed: true,
        rules: [
          {
            name: 'cloud',
            priority: 10,
            attribute: 'data_class',
            operator: 'eq',
            value: 'general',
            action: 'cloud',
            model: 'gpt-4o',
            fallback: '',
            enabled: true,
          },
        ],
      },
    }),
    'general',
  );
  assert.equal(v.egress, 'local'); // loosen rejected → ceiling stays local → cloud demoted
});

test('model call: NO pipeline ⇒ allowed, cloud, no forced masking (legacy fallback)', () => {
  const v = enforceModelCall(null, 'pii');
  assert.equal(v.allow, true);
  assert.equal(v.egress, 'cloud');
  assert.equal(v.forceLocal, false);
  assert.equal(v.requirePiiMasking, false);
  assert.equal(v.noPipeline, true);
});

// ─── enforcementResource — the pipeline-tagged audit resource ───────────────────────────────────────

test('enforcementResource tags the resource with the pipeline id when bound', () => {
  assert.equal(enforcementResource('data:dom_inv', contract()), 'data:dom_inv pipeline:pl_test');
});

test('enforcementResource leaves the resource untagged when no pipeline', () => {
  assert.equal(enforcementResource('data:dom_inv', null), 'data:dom_inv');
});
