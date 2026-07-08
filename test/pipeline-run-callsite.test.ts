import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type PipelineContract,
  enforceDataAccess,
  enforceModelCall,
} from '@/lib/pipeline-enforcement';
import { ORG_GUARDRAIL_DEFAULTS, ORG_POLICY_DEFAULTS } from '@/lib/pipeline-governance';

// PA-16b — call-site enforcement tests. They assert the EXACT decisions the agent-run and chat-run
// paths make at their gate points, using the REAL pure decisions with no mocks:
//   • agent path: data key 'retrieval' (grounded run) + data-class 'general'/'none'.
//   • chat path : data keys <projectId> / 'org-knowledge' + the request's data_class.
// These prove the gate fires (deny/block) under a restrictive contract and is fully permissive under
// a null contract (the ADDITIVE, no-regression guarantee) — the same invariant runAgent/chat rely on.

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

// ─── the ADDITIVE guarantee: a null contract never gates anything (legacy behaviour) ───────────────
test('NULL contract ⇒ agent retrieval + model call both permissive (no regression)', () => {
  assert.equal(enforceDataAccess(null, 'retrieval').allow, true);
  assert.equal(enforceDataAccess(null, 'retrieval').noPipeline, true);
  const m = enforceModelCall(null, 'general');
  assert.equal(m.allow, true);
  assert.equal(m.noPipeline, true);
});

test('NULL contract ⇒ chat retrieval + model call both permissive (no regression)', () => {
  assert.equal(enforceDataAccess(null, 'proj_finance').allow, true);
  assert.equal(enforceDataAccess(null, 'org-knowledge').allow, true);
  assert.equal(enforceModelCall(null, 'pii').allow, true);
});

// ─── agent path: the HARD data ceiling at retrieval ────────────────────────────────────────────────
test('agent grounded run — retrieval DENIED when the allowlist excludes it', () => {
  const v = enforceDataAccess(contract({ dataAllowlist: ['dom_hr'] }), 'retrieval');
  assert.equal(v.allow, false);
  assert.match(v.reason, /OUTSIDE the pipeline data allowlist/);
});

test('agent grounded run — retrieval ALLOWED when the allowlist covers it', () => {
  const v = enforceDataAccess(contract({ dataAllowlist: ['retrieval'] }), 'retrieval');
  assert.equal(v.allow, true);
});

// ─── agent path: the egress leash at the model call ────────────────────────────────────────────────
test('agent run — model call BLOCKED by egress leash (egress off + a cloud rule for the data-class)', () => {
  const v = enforceModelCall(
    contract({
      routing: {
        egressAllowed: false,
        rules: [
          {
            name: 'cloud-general',
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
  assert.equal(v.allow, false);
  assert.match(v.reason, /egress leash blocked/);
});

test('agent run — default routing leashes to LOCAL (allowed, on-prem)', () => {
  const v = enforceModelCall(contract(), 'general');
  assert.equal(v.allow, true);
  assert.equal(v.forceLocal, true);
});

// ─── chat path: the egress leash forces local for a cloud plan ─────────────────────────────────────
test('chat run — a data_class routed to cloud with egress off is BLOCKED', () => {
  const v = enforceModelCall(
    contract({
      routing: {
        egressAllowed: false,
        rules: [
          {
            name: 'cloud-public',
            priority: 10,
            attribute: 'data_class',
            operator: 'eq',
            value: 'public',
            action: 'cloud',
            model: 'gpt-4o',
            fallback: '',
            enabled: true,
          },
        ],
      },
    }),
    'public',
  );
  assert.equal(v.allow, false);
});

test('chat run — org-knowledge read denied outside the allowlist, allowed inside', () => {
  assert.equal(enforceDataAccess(contract({ dataAllowlist: [] }), 'org-knowledge').allow, false);
  assert.equal(
    enforceDataAccess(contract({ dataAllowlist: ['org-knowledge'] }), 'org-knowledge').allow,
    true,
  );
});
