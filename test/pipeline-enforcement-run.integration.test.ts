import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppSpec } from '@/lib/app-model';
import { type AppRunDeps, runApp } from '@/lib/app-run';
import { type PipelineContract } from '@/lib/pipeline-enforcement';
import { ORG_GUARDRAIL_DEFAULTS, ORG_POLICY_DEFAULTS } from '@/lib/pipeline-governance';

// This integration test exercises the REAL runApp executor (the actual scheduler + step dispatch +
// pure enforcement wiring), mocking ONLY the two external boundaries (runAgent + queryDomain) + a
// no-op persist — exactly the seam app-run.test.ts uses. It proves the PA-16 gate is wired into the
// run path: a restrictive contract denies where expected, and a no-contract run is UNCHANGED.

function spec(steps: AppSpec['steps'], edges: AppSpec['edges'] = []): AppSpec {
  return {
    id: 'app_e', orgId: 'default', ownerId: 'u1', title: 'Enforce', summary: '', visibility: 'private',
    published: false, trigger: { kind: 'on-demand' }, steps, edges,
  };
}

// connector-query (reads dom_hr) → agent (decide) → output.
const LINEAR = spec(
  [
    { id: 's1', label: 'read quota', kind: 'connector-query', domain: 'dom_hr' },
    { id: 's2', label: 'decide', kind: 'agent', agentId: 'ag1' },
    { id: 's3', label: 'out', kind: 'output', sink: 'console' },
  ],
  [{ from: 's1', to: 's2' }, { from: 's2', to: 's3' }],
);

function fakeDeps(over: Partial<AppRunDeps> = {}): AppRunDeps {
  return {
    async runAgent(agentId, query) {
      return { id: `run_${agentId}`, answer: `decided: ${query}`, status: 'done', citations: [] };
    },
    async listDomains() {
      return [{ id: 'dom_hr', label: 'quota', connectorId: 'con_hr', resource: 'employee_quota' }];
    },
    async getConnector(id) {
      return { id, type: 'mysql', endpoint: 'mysql://x' };
    },
    async queryDomain() {
      return { result: { rows: [{ used: 3, cap: 5 }], count: 1, dialect: 'mysql' }, detail: 'read 1 row' };
    },
    async runGuardrail() {
      return { blocked: false, detail: 'ok' };
    },
    async persist() {},
    async materializeAgent(_spec, step) {
      step.agentId = `ag_mat_${step.id}`;
      return step.agentId;
    },
    async renderReport(view, format) {
      return {
        filename: `offgrid-app-run-${view.id}.${format}`,
        contentType: format === 'md' ? 'text/markdown' : 'application/pdf',
        bytes: new TextEncoder().encode(`report:${view.id}`),
        manifest: { algorithm: 'ed25519', sha256: 'a'.repeat(64), signature: 'sig' },
      };
    },
    async sendEmail() {
      return { ok: false, configured: false, reason: 'test: SMTP not configured' };
    },
    ...over,
  };
}

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

test('NO contract ⇒ run completes exactly as before (no regression)', async () => {
  const out = await runApp(LINEAR, {}, { orgId: 'default', runId: 'r_none' }, fakeDeps());
  assert.equal(out.status, 'done');
  // All three steps ran and produced results.
  assert.deepEqual(out.steps.map((s) => s.stepId), ['s1', 's2', 's3']);
  assert.equal(out.steps.find((s) => s.stepId === 's1')?.status, 'done');
});

test('contract WITH dom_hr allowed ⇒ connector read proceeds; run completes', async () => {
  const out = await runApp(
    LINEAR,
    {},
    { orgId: 'default', runId: 'r_allow', contract: contract({ dataAllowlist: ['dom_hr'] }) },
    fakeDeps(),
  );
  assert.equal(out.status, 'done');
  assert.equal(out.steps.find((s) => s.stepId === 's1')?.status, 'done');
});

test('contract WITHOUT dom_hr in allowlist ⇒ connector read DENIED, run halts', async () => {
  const out = await runApp(
    LINEAR,
    {},
    { orgId: 'default', runId: 'r_deny', contract: contract({ dataAllowlist: ['dom_other'] }) },
    fakeDeps(),
  );
  assert.equal(out.status, 'error');
  const s1 = out.steps.find((s) => s.stepId === 's1');
  assert.equal(s1?.status, 'error');
  assert.match(s1?.detail ?? '', /data access denied by pipeline/);
  // The downstream agent step never ran (the run halted at the denied read).
  assert.equal(out.steps.find((s) => s.stepId === 's2'), undefined);
});

test('contract with egress OFF + a cloud rule for the run data-class ⇒ agent model call BLOCKED', async () => {
  // dom_hr is allowed so the connector read passes; the agent step then hits the egress leash. The
  // run touched a connector, so the agent step's data-class is 'general' — match a cloud rule for it
  // with egress OFF → block.
  const out = await runApp(
    LINEAR,
    {},
    {
      orgId: 'default',
      runId: 'r_egress',
      contract: contract({
        dataAllowlist: ['dom_hr'],
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
    },
    fakeDeps(),
  );
  assert.equal(out.status, 'error');
  assert.equal(out.steps.find((s) => s.stepId === 's1')?.status, 'done'); // read passed
  const s2 = out.steps.find((s) => s.stepId === 's2');
  assert.equal(s2?.status, 'error'); // model call blocked
  assert.match(s2?.detail ?? '', /egress leash/);
});

test('contract with default (local) routing ⇒ agent runs on-prem, run completes', async () => {
  // No routing rules ⇒ local by default; org locked maxEgress=local keeps it local (allowed).
  const out = await runApp(
    LINEAR,
    {},
    { orgId: 'default', runId: 'r_local', contract: contract({ dataAllowlist: ['dom_hr'] }) },
    fakeDeps(),
  );
  assert.equal(out.status, 'done');
  assert.equal(out.steps.find((s) => s.stepId === 's2')?.status, 'done');
});
