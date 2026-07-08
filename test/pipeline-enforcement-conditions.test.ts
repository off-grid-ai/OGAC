// CONDITION-COVERAGE tests for pipeline-enforcement.ts — target the compound boolean guards + every
// arm of the maxEgress-ceiling collapse ternary + the reason ternary, which the base
// pipeline-enforcement.test.ts leaves partially covered. Additive only; imports existing exports.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type PipelineContract,
  enforceDataAccess,
  enforceModelCall,
  enforcementResource,
} from '@/lib/pipeline-enforcement';
import type { GovernanceControls, PipelineRouting } from '@/lib/pipelines-policy';

// A minimal, FULLY DEFAULT-mode org baseline so overlays can freely set any control level/bool. This
// lets us exercise the ceiling-collapse arms (local / block / cloud) without the org lock getting in
// the way — the arms under test are in enforceModelCall, not in effectiveGovernance.
const OPEN_POLICY: GovernanceControls = {
  maxEgress: { mode: 'default', level: 'allow' },
  requirePurpose: { mode: 'default', bool: false },
};
const OPEN_GUARDRAIL: GovernanceControls = {
  requirePiiMasking: { mode: 'default', bool: false },
  blockPromptInjection: { mode: 'default', bool: false },
};

function contract(over: Partial<PipelineContract> = {}): PipelineContract {
  return {
    pipelineId: 'pl_cond',
    dataAllowlist: [],
    routing: {},
    orgPolicyDefaults: OPEN_POLICY,
    orgGuardrailDefaults: OPEN_GUARDRAIL,
    policyOverlay: {},
    guardrailOverlay: {},
    ...over,
  };
}

// A routing envelope that yields a 'cloud' egress for the given data-class (egress ON + a cloud rule).
function cloudRouting(dataClass: string): PipelineRouting {
  return {
    egressAllowed: true,
    rules: [
      {
        name: 'cloud-rule',
        priority: 10,
        attribute: 'data_class',
        operator: 'eq',
        value: dataClass,
        action: 'cloud',
        model: 'gpt-4o',
        fallback: '',
        enabled: true,
      },
    ],
  };
}

// ─── enforceDataAccess: the `requested ?? ''` nullish arm ──────────────────────────────────────────

test('data access: null requested id → trimmed to empty → denied (nullish-coalescing arm)', () => {
  // @ts-expect-error exercising the runtime `requested ?? ''` guard with null
  const v = enforceDataAccess(contract({ dataAllowlist: ['dom_x'] }), null);
  assert.equal(v.allow, false);
  assert.equal(v.requested, '');
});

test('data access: a defined request id skips the nullish arm and is echoed trimmed', () => {
  const v = enforceDataAccess(contract({ dataAllowlist: ['dom_x'] }), '  dom_x  ');
  assert.equal(v.allow, true);
  assert.equal(v.requested, 'dom_x');
  assert.match(v.reason, /within the pipeline data allowlist/);
});

// ─── enforceModelCall: the maxEgress ceiling-collapse ternary — every arm ──────────────────────────

test('model call: cloud egress with NO maxEgress ceiling stays cloud (ceiling === undefined arm)', () => {
  // orgPolicyDefaults has NO maxEgress here → levelOf() returns undefined → collapse skipped entirely.
  const noCeiling: GovernanceControls = { requirePurpose: { mode: 'default', bool: false } };
  const v = enforceModelCall(
    contract({ orgPolicyDefaults: noCeiling, routing: cloudRouting('general') }),
    'general',
  );
  assert.equal(v.egress, 'cloud');
  assert.equal(v.allow, true);
  assert.equal(v.forceLocal, false);
});

test('model call: ceiling "cloud" ≥ cloud egress → NOT demoted (egressRank not > ceilingRank)', () => {
  // maxEgress=cloud, egress=cloud → egressRank === ceilingRank → the `>` guard is false → no collapse.
  const v = enforceModelCall(
    contract({
      policyOverlay: { maxEgress: { mode: 'default', level: 'cloud' } },
      routing: cloudRouting('general'),
    }),
    'general',
  );
  assert.equal(v.egress, 'cloud');
});

test('model call: ceiling "local" demotes a cloud egress to local (local arm of the collapse ternary)', () => {
  const v = enforceModelCall(
    contract({
      policyOverlay: { maxEgress: { mode: 'default', level: 'local' } },
      routing: cloudRouting('general'),
    }),
    'general',
  );
  assert.equal(v.egress, 'local');
  assert.equal(v.forceLocal, true);
  assert.equal(v.allow, true);
  assert.match(v.reason, /leashed to LOCAL/);
});

test('model call: ceiling "mask" collapses a cloud egress to block (else arm → block)', () => {
  const v = enforceModelCall(
    contract({
      policyOverlay: { maxEgress: { mode: 'default', level: 'mask' } },
      routing: cloudRouting('general'),
    }),
    'general',
  );
  assert.equal(v.egress, 'block');
  assert.equal(v.allow, false);
  assert.match(v.reason, /blocked/);
});

test('model call: ceiling "block" collapses a cloud egress to block (else arm → block)', () => {
  const v = enforceModelCall(
    contract({
      policyOverlay: { maxEgress: { mode: 'default', level: 'block' } },
      routing: cloudRouting('general'),
    }),
    'general',
  );
  assert.equal(v.egress, 'block');
  assert.equal(v.allow, false);
});

test('model call: a "cloud" ceiling literal path — cloud egress leash below the ceiling is untouched', () => {
  // Egress derives to LOCAL (no cloud rule) and ceiling is cloud → egressRank(local) < ceilingRank(cloud)
  // → `>` false → no collapse → stays local. Confirms the guard is genuinely two-sided.
  const v = enforceModelCall(
    contract({ policyOverlay: { maxEgress: { mode: 'default', level: 'cloud' } }, routing: {} }),
    'general',
  );
  assert.equal(v.egress, 'local');
});

// ─── enforceModelCall: the reason ternary — !allow vs forceLocal vs permitted ──────────────────────

test('model call: permitted cloud egress → the "egress permitted" reason arm', () => {
  const v = enforceModelCall(
    contract({ routing: cloudRouting('general') }),
    'general',
  );
  assert.equal(v.egress, 'cloud');
  assert.match(v.reason, /egress "cloud" permitted/);
});

// ─── enforceModelCall: guardrail + policy boolean readouts (boolOn true/false arms) ────────────────

test('model call: guardrail overlay ON flips requirePiiMasking + blockPromptInjection true', () => {
  const guardOn: GovernanceControls = {
    requirePiiMasking: { mode: 'default', bool: true },
    blockPromptInjection: { mode: 'default', bool: true },
  };
  const v = enforceModelCall(
    contract({ orgGuardrailDefaults: guardOn, routing: cloudRouting('general') }),
    'general',
  );
  assert.equal(v.requirePiiMasking, true);
  assert.equal(v.blockPromptInjection, true);
});

test('model call: policy overlay requirePurpose ON is read as true (boolOn true arm)', () => {
  const v = enforceModelCall(
    contract({ policyOverlay: { requirePurpose: { mode: 'default', bool: true } } }),
    'general',
  );
  assert.equal(v.requirePurpose, true);
});

test('model call: default-off controls read false (boolOn false / absent-control arm)', () => {
  const v = enforceModelCall(contract({ routing: cloudRouting('general') }), 'general');
  assert.equal(v.requirePiiMasking, false);
  assert.equal(v.blockPromptInjection, false);
  assert.equal(v.requirePurpose, false);
});

// ─── enforcementResource: both arms ────────────────────────────────────────────────────────────────

test('enforcementResource: bound pipeline arm tags, null arm does not', () => {
  assert.equal(enforcementResource('base', contract()), 'base pipeline:pl_cond');
  assert.equal(enforcementResource('base', null), 'base');
});
