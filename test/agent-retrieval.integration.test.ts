import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentRetrievalDeps } from '../src/lib/agent-retrieval.ts';
import { retrieveAgentSources } from '../src/lib/agent-retrieval.ts';
import type { DataDomain } from '../src/lib/data-domains.ts';
import type { PipelineContract } from '../src/lib/pipeline-enforcement.ts';
import { ORG_GUARDRAIL_DEFAULTS, ORG_POLICY_DEFAULTS } from '../src/lib/pipeline-governance.ts';

const A: DataDomain = {
  id: 'dom_hr_a',
  orgId: 'org_a',
  label: 'Employee quota',
  aliases: ['staff allowance'],
  connectorId: 'con_a',
  resource: 'employee_quota',
};
const B: DataDomain = { ...A, id: 'dom_hr_b', orgId: 'org_b', connectorId: 'con_b' };

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

function harness(domains: DataDomain[] = [A, B]) {
  const calls = { list: [] as string[], retrieve: 0 };
  const deps: AgentRetrievalDeps = {
    async listDomains(orgId) {
      calls.list.push(orgId);
      // Deliberately return both tenants: the pure decision must still confine to the run org.
      return domains;
    },
    async retrieve(query, _k, _opts, context) {
      calls.retrieve += 1;
      assert.equal(context?.orgId, 'org_a');
      assert.deepEqual(context?.dataDomains, [A]);
      return {
        query,
        decision: { intent: ['database'], reason: 'test' },
        hits: [
          {
            sourceId: 'connector',
            sourceKind: 'database',
            title: 'Quota',
            snippet: 'used=3',
            ref: 'connector:con_a/employee_quota#0',
            score: 1,
          },
        ],
      };
    },
  };
  return { calls, deps };
}

test('allowed real domain id proceeds to retrieval with the same org-scoped snapshot', async () => {
  const { calls, deps } = harness();
  const out = await retrieveAgentSources(
    {
      query: 'count employee quota records',
      k: 6,
      orgId: 'org_a',
      contract: contract(['dom_hr_a']),
    },
    deps,
  );
  assert.equal(out.allow, true);
  assert.deepEqual(out.requestedDomainIds, ['dom_hr_a']);
  assert.deepEqual(calls.list, ['org_a']);
  assert.equal(calls.retrieve, 1);
});

test('out-of-allowlist domain denies before retrieval I/O', async () => {
  const { calls, deps } = harness();
  const out = await retrieveAgentSources(
    {
      query: 'count employee quota records',
      k: 6,
      orgId: 'org_a',
      contract: contract(['dom_other']),
    },
    deps,
  );
  assert.equal(out.allow, false);
  assert.deepEqual(out.requestedDomainIds, ['dom_hr_a']);
  assert.equal(out.allow ? null : out.denied.requested, 'dom_hr_a');
  assert.equal(calls.retrieve, 0, 'denial must short-circuit before the retrieval boundary');
});

test('KB-only request preserves behavior without reading domain metadata', async () => {
  const calls = { list: 0, retrieve: 0 };
  const deps: AgentRetrievalDeps = {
    async listDomains() {
      calls.list += 1;
      return [A];
    },
    async retrieve(query, _k, _opts, context) {
      calls.retrieve += 1;
      assert.equal(context?.orgId, 'org_a');
      assert.equal(context?.dataDomains, undefined);
      return { query, decision: { intent: ['kb'], reason: 'test' }, hits: [] };
    },
  };
  const out = await retrieveAgentSources(
    { query: 'what is the claims SOP?', k: 6, orgId: 'org_a', contract: contract([]) },
    deps,
  );
  assert.equal(out.allow, true);
  assert.deepEqual(out.requestedDomainIds, []);
  assert.deepEqual(calls, { list: 0, retrieve: 1 });
});

test('no pipeline contract keeps the additive path and still scopes retrieval to the run org', async () => {
  const calls = { list: 0, retrieve: 0 };
  const deps: AgentRetrievalDeps = {
    async listDomains() {
      calls.list += 1;
      return [A];
    },
    async retrieve(query, _k, _opts, context) {
      calls.retrieve += 1;
      assert.equal(context?.orgId, 'org_a');
      return { query, decision: { intent: ['database'], reason: 'test' }, hits: [] };
    },
  };
  const out = await retrieveAgentSources(
    { query: 'count employee quota records', k: 6, orgId: 'org_a', contract: null },
    deps,
  );
  assert.equal(out.allow, true);
  assert.deepEqual(calls, { list: 0, retrieve: 1 });
});

test('bound database intent with no declared-domain match disables every structured source', async () => {
  let structuredAccess: unknown;
  const deps: AgentRetrievalDeps = {
    async listDomains() {
      return [A];
    },
    async retrieve(query, _k, _opts, context) {
      structuredAccess = context?.structuredAccess;
      return { query, decision: { intent: ['database'], reason: 'test' }, hits: [] };
    },
  };
  const out = await retrieveAgentSources(
    {
      query: 'count mortgage arrears records',
      k: 6,
      orgId: 'org_a',
      contract: contract([]),
    },
    deps,
  );
  assert.equal(out.allow, true);
  assert.deepEqual(out.requestedDomainIds, []);
  assert.deepEqual(structuredAccess, { state: 'disabled', reason: 'no authorized domain matched' });
});
