import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  authorizeAgentDomains,
  requestedAgentDomainIds,
} from '../src/lib/agent-retrieval-policy.ts';
import type { DataDomain } from '../src/lib/data-domains.ts';
import type { PipelineContract } from '../src/lib/pipeline-enforcement.ts';
import { ORG_GUARDRAIL_DEFAULTS, ORG_POLICY_DEFAULTS } from '../src/lib/pipeline-governance.ts';

const DOMAINS: DataDomain[] = [
  {
    id: 'dom_hr_a',
    orgId: 'org_a',
    label: 'Employee quota',
    aliases: ['staff allowance'],
    connectorId: 'con_a',
    resource: 'employee_quota',
  },
  {
    id: 'dom_hr_b',
    orgId: 'org_b',
    label: 'Employee quota',
    aliases: ['staff allowance'],
    connectorId: 'con_b',
    resource: 'employee_quota',
  },
];

function contract(allowlist: string[]): PipelineContract {
  return {
    pipelineId: 'pl_a',
    dataAllowlist: allowlist,
    routing: {},
    orgPolicyDefaults: ORG_POLICY_DEFAULTS,
    orgGuardrailDefaults: ORG_GUARDRAIL_DEFAULTS,
    policyOverlay: {},
    guardrailOverlay: {},
  };
}

test('requested agent domain ids resolve the real id within the run org only', () => {
  assert.deepEqual(
    requestedAgentDomainIds('count employee quota records', 'org_a', DOMAINS, true),
    ['dom_hr_a'],
  );
  assert.deepEqual(
    requestedAgentDomainIds('count employee quota records', 'org_b', DOMAINS, true),
    ['dom_hr_b'],
  );
});

test('KB/tool-only retrieval requests no declared data domain', () => {
  assert.deepEqual(requestedAgentDomainIds('what is the claims SOP?', 'org_a', DOMAINS, false), []);
});

test('domain authorization allows actual in-scope ids and denies the first outsider', () => {
  const allowed = authorizeAgentDomains(contract(['dom_hr_a']), ['dom_hr_a', 'dom_hr_a']);
  assert.equal(allowed.allow, true);
  assert.equal(allowed.verdicts.length, 1, 'duplicate ids are checked once');

  const denied = authorizeAgentDomains(contract(['dom_other']), [' dom_hr_a ']);
  assert.equal(denied.allow, false);
  assert.equal(denied.denied?.requested, 'dom_hr_a');
});

test('no requested domain is allowed and a null contract preserves legacy access', () => {
  assert.equal(authorizeAgentDomains(contract([]), []).allow, true);
  const legacy = authorizeAgentDomains(null, ['dom_hr_a']);
  assert.equal(legacy.allow, true);
  assert.equal(legacy.verdicts[0]?.noPipeline, true);
});
