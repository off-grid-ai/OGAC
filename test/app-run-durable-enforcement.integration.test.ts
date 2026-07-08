import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppSpec, AppStep } from '@/lib/app-model';
import type { AppRunDeps, StepResult } from '@/lib/app-run';
import type { AppRunWorkflowInput } from '@/lib/app-run-durable';
import { type PipelineContract } from '@/lib/pipeline-enforcement';
import { ORG_GUARDRAIL_DEFAULTS, ORG_POLICY_DEFAULTS } from '@/lib/pipeline-governance';
import { executeStepActivity, resolveContractActivity } from '@/worker/app-run.activities';

// ── PA-16 DURABLE-PATH enforcement proof ──────────────────────────────────────────────────────────
//
// The P0 governance hole: the durable Temporal WORKER path (executeStepActivity) built the run ctx
// WITHOUT the pipeline contract, so the data-allowlist ceiling + egress leash were NOT enforced on the
// live durable execution path — only inline runs (runApp, exercised by pipeline-enforcement-run.
// integration.test.ts) were governed.
//
// This test exercises the REAL executeStepActivity (the exact function Temporal invokes per step),
// threading a resolved contract exactly as the workflow now does, and proves it enforces IDENTICALLY
// to inline: an out-of-allowlist connector read is DENIED, and the egress leash blocks a model call.
// It injects ONLY the two external boundaries (queryDomain + runAgent) + a no-op persist — the same
// seam the inline enforcement test uses — so the proof is DB-free and mirrors inline exactly.

// A connector-query step reading dom_hr (the data ceiling is checked here) and an agent step (the
// egress leash is checked here). These are the two enforced step kinds, run individually on the
// worker path below.
const READ_STEP: AppStep = { id: 's1', label: 'read quota', kind: 'connector-query', domain: 'dom_hr' };
const AGENT_STEP: AppStep = { id: 's2', label: 'decide', kind: 'agent', agentId: 'ag1' };

function spec(): AppSpec {
  return {
    id: 'app_dur', orgId: 'default', ownerId: 'u1', title: 'Durable Enforce', summary: '',
    visibility: 'private', published: false, trigger: { kind: 'on-demand' },
    steps: [READ_STEP, AGENT_STEP, { id: 's3', label: 'out', kind: 'output', sink: 'console' }],
    edges: [{ from: 's1', to: 's2' }, { from: 's2', to: 's3' }],
  };
}

function wfInput(runId: string): AppRunWorkflowInput {
  return { appId: 'app_dur', runId, input: {}, orgId: 'default', caller: 'tester' };
}

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
    async scanPii() {
      return { hits: false, entities: [], engine: 'regex' };
    },
    async persist() {},
    async materializeAgent(_spec, step) {
      step.agentId = `ag_mat_${step.id}`;
      return step.agentId;
    },
    async renderReport(view, format) {
      return {
        filename: `r.${format}`,
        contentType: 'application/pdf',
        bytes: new TextEncoder().encode('r'),
        manifest: { algorithm: 'ed25519', sha256: 'a'.repeat(64), signature: 'sig' },
      };
    },
    async sendEmail() {
      return { ok: false, configured: false, reason: 'test: not configured' };
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

// ── The data-allowlist ceiling on the WORKER path ─────────────────────────────────────────────────

test('durable worker: NO contract ⇒ connector read proceeds (legacy allow, no regression)', async () => {
  const r = await executeStepActivity(wfInput('r_none'), spec(), READ_STEP, [], null, fakeDeps());
  assert.equal(r.status, 'done');
  assert.match(r.output ?? '', /quota/);
});

test('durable worker: contract WITH dom_hr allowed ⇒ connector read proceeds', async () => {
  const r = await executeStepActivity(
    wfInput('r_allow'), spec(), READ_STEP, [], contract({ dataAllowlist: ['dom_hr'] }), fakeDeps(),
  );
  assert.equal(r.status, 'done');
});

test('durable worker: contract WITHOUT dom_hr ⇒ connector read DENIED (data ceiling enforced)', async () => {
  const r = await executeStepActivity(
    wfInput('r_deny'), spec(), READ_STEP, [], contract({ dataAllowlist: ['dom_other'] }), fakeDeps(),
  );
  assert.equal(r.status, 'error');
  assert.match(r.detail ?? '', /data access denied by pipeline/);
});

// ── The egress leash on the WORKER path ───────────────────────────────────────────────────────────

test('durable worker: egress OFF + cloud rule for the run data-class ⇒ agent model call BLOCKED', async () => {
  // A prior connector read makes the agent step's data-class 'general'; egress off + a cloud rule
  // matching 'general' → the leash blocks the model call. This is the SAME leash the inline test hits.
  const prior: StepResult[] = [{ stepId: 's1', kind: 'connector-query', status: 'done', output: 'rows' }];
  const r = await executeStepActivity(
    wfInput('r_egress'),
    spec(),
    AGENT_STEP,
    prior,
    contract({
      dataAllowlist: ['dom_hr'],
      routing: {
        egressAllowed: false,
        rules: [
          {
            name: 'cloud-general', priority: 10, attribute: 'data_class', operator: 'eq',
            value: 'general', action: 'cloud', model: 'gpt-4o', fallback: '', enabled: true,
          },
        ],
      },
    }),
    fakeDeps(),
  );
  assert.equal(r.status, 'error');
  assert.match(r.detail ?? '', /egress leash/);
});

test('durable worker: default (local) routing ⇒ agent runs on-prem, step completes', async () => {
  const prior: StepResult[] = [{ stepId: 's1', kind: 'connector-query', status: 'done', output: 'rows' }];
  const r = await executeStepActivity(
    wfInput('r_local'), spec(), AGENT_STEP, prior, contract({ dataAllowlist: ['dom_hr'] }), fakeDeps(),
  );
  assert.equal(r.status, 'done');
  assert.match(r.output ?? '', /decided/);
});

// ── resolveContractActivity — the resolver seam mirrors the inline route ───────────────────────────

test('resolveContractActivity: null/empty pipelineId ⇒ null (no binding ⇒ legacy allow)', async () => {
  assert.equal(await resolveContractActivity(null, 'default'), null);
  assert.equal(await resolveContractActivity(undefined, 'default'), null);
  assert.equal(await resolveContractActivity('', 'default'), null);
});
