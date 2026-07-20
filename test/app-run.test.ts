import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppSpec } from '@/lib/app-model';
import {
  applyStepResult,
  deriveRunStatus,
  initState,
  nextRunnableSteps,
  topoOrder,
} from '@/lib/app-run-plan';
import {
  type AppRunDeps,
  buildAgentQuery,
  executeStep,
  providedSourcesFromPriorResults,
  resolveDomainByIdOrLabel,
  runApp,
  type StepResult,
} from '@/lib/app-run';
import { resolveDomain } from '@/lib/data-domains';

// A 3-step reimbursement-shaped spec: connector-query (quota) → agent (decide) → output.
function spec(steps: AppSpec['steps'], edges: AppSpec['edges'] = []): AppSpec {
  return {
    id: 'app1', orgId: 'default', ownerId: 'u1', title: 'T', summary: '', visibility: 'private',
    published: false, trigger: { kind: 'on-demand' }, steps, edges,
  };
}

const LINEAR = spec(
  [
    { id: 's1', label: 'check quota', kind: 'connector-query', domain: 'reimbursement quota' },
    { id: 's2', label: 'decide eligibility', kind: 'agent', agentId: 'ag1' },
    { id: 's3', label: 'Output', kind: 'output', sink: 'console' },
  ],
  [{ from: 's1', to: 's2' }, { from: 's2', to: 's3' }],
);

// Fakes for the two external boundaries + a no-op persist. No live DB/gateway.
function fakeDeps(over: Partial<AppRunDeps> = {}): AppRunDeps {
  return {
    async runAgent(agentId, query) {
      return { id: `run_${agentId}`, answer: `decided from: ${query}`, status: 'done', citations: [] };
    },
    async listDomains() {
      return [{ id: 'd_hr', label: 'reimbursement quota', connectorId: 'con_hr', resource: 'employee_quota' }];
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
      // Fake materialization: mint a stable id from the step and cache it back (as prod does).
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
      // Default fake: SMTP not configured (the honest air-gap default).
      return { ok: false, configured: false, reason: 'test: SMTP not configured' };
    },
    ...over,
  };
}

test('topoOrder returns steps in edge order for a linear graph', () => {
  assert.deepEqual(topoOrder(LINEAR).map((s) => s.id), ['s1', 's2', 's3']);
});

test('nextRunnableSteps advances only when predecessors are complete', () => {
  assert.deepEqual(nextRunnableSteps(LINEAR, []).map((s) => s.id), ['s1']);
  assert.deepEqual(nextRunnableSteps(LINEAR, ['s1']).map((s) => s.id), ['s2']);
  assert.deepEqual(nextRunnableSteps(LINEAR, ['s1', 's2']).map((s) => s.id), ['s3']);
  assert.deepEqual(nextRunnableSteps(LINEAR, ['s1', 's2', 's3']), []);
});

test('applyStepResult advances per-step status; deriveRunStatus reflects it', () => {
  let state = initState(LINEAR, 'r1');
  assert.equal(deriveRunStatus(state.steps), 'queued');
  state = applyStepResult(state, 's1', { status: 'done' });
  assert.equal(state.steps.find((s) => s.id === 's1')?.status, 'done');
  assert.equal(deriveRunStatus(state.steps), 'running');
});

test('a human step drives the run to awaiting_human (mid-workflow pause)', () => {
  let state = initState(LINEAR, 'r2');
  state = applyStepResult(state, 's1', { status: 'awaiting_human' });
  assert.equal(deriveRunStatus(state.steps), 'awaiting_human');
});

test('buildAgentQuery threads prior-step output as context', () => {
  const prior: StepResult[] = [{ stepId: 's1', kind: 'connector-query', status: 'done', output: 'quota: 3/5' }];
  const q = buildAgentQuery({ id: 's2', label: 'decide', kind: 'agent', agentId: 'ag1' }, prior);
  assert.match(q, /CONTEXT FROM PRIOR STEPS/);
  assert.match(q, /quota: 3\/5/);
  assert.match(q, /TASK: decide/);
});

test('providedSourcesFromPriorResults carries only governed connector evidence', () => {
  const sources = providedSourcesFromPriorResults([
    {
      stepId: 's1',
      kind: 'connector-query',
      status: 'done',
      output: 'accounts: 5 rows',
      refs: [{ name: 'crm:accounts' }],
    },
    { stepId: 's2', kind: 'guardrail', status: 'done', output: 'clean' },
  ]);

  assert.deepEqual(sources, [
    {
      sourceId: 's1',
      sourceKind: 'database',
      title: 'crm:accounts',
      snippet: 'accounts: 5 rows',
      ref: 'crm:accounts',
      score: 1,
    },
  ]);
});

test('executeStep(human) returns awaiting_human WITHOUT blocking', async () => {
  const r = await executeStep(LINEAR, LINEAR.steps[0], [], { orgId: 'default', runId: 'r3' }, fakeDeps());
  // s0 is connector-query here; check a real human step:
  const hr = await executeStep(
    spec([{ id: 'h', label: 'review', kind: 'human' }]),
    { id: 'h', label: 'review', kind: 'human' },
    [],
    { orgId: 'default', runId: 'r3' },
    fakeDeps(),
  );
  assert.equal(hr.status, 'awaiting_human');
  assert.equal(r.status, 'done'); // connector-query succeeded via fake
});

test('runApp executes a 3-step spec in order to completion (connector→agent→output)', async () => {
  let agentContext: import('@/lib/agent-run-context').RunContext | undefined;
  const out = await runApp(
    LINEAR,
    {},
    { orgId: 'default', runId: 'r4' },
    fakeDeps({
      async runAgent(agentId, query, _caller, _review, _org, context) {
        agentContext = context;
        return { id: `run_${agentId}`, answer: `decided from: ${query}`, status: 'done', citations: [] };
      },
    }),
  );
  assert.equal(out.status, 'done');
  assert.deepEqual(out.steps.map((s) => s.stepId), ['s1', 's2', 's3']);
  // the agent step saw the connector output threaded in
  assert.match(out.steps[1].output ?? '', /decided from:/);
  assert.equal(agentContext?.providedSources?.[0]?.ref, 'con_hr:employee_quota');
  assert.match(agentContext?.providedSources?.[0]?.snippet ?? '', /reimbursement quota/);
});

test('runApp stops at awaiting_human when a human step is hit', async () => {
  const withHuman = spec(
    [
      { id: 's1', label: 'decide', kind: 'agent', agentId: 'ag1' },
      { id: 's2', label: 'review', kind: 'human' },
      { id: 's3', label: 'Output', kind: 'output', sink: 'console' },
    ],
    [{ from: 's1', to: 's2' }, { from: 's2', to: 's3' }],
  );
  const out = await runApp(withHuman, {}, { orgId: 'default', runId: 'r5' }, fakeDeps());
  assert.equal(out.status, 'awaiting_human');
  // the output step must NOT have run yet
  assert.equal(out.steps.find((s) => s.stepId === 's3'), undefined);
});

// ─── GAP #106-a — resolve step.domain by ID first, then LABEL/alias ───────────────────────────────

const DOMS = [
  { id: 'dom_inv', label: 'Invoices', connectorId: 'con_s3', resource: 'invoices' },
  { id: 'dom_hr', label: 'Reimbursement Quota', connectorId: 'con_hr', resource: 'employee_quota' },
];

test('resolveDomainByIdOrLabel resolves a compiler-emitted domain ID', () => {
  const r = resolveDomainByIdOrLabel('dom_inv', DOMS, resolveDomain as never);
  assert.equal(r?.id, 'dom_inv');
  assert.equal(r?.label, 'Invoices');
});

test('resolveDomainByIdOrLabel resolves a human label to the same domain', () => {
  const r = resolveDomainByIdOrLabel('Invoices', DOMS, resolveDomain as never);
  assert.equal(r?.id, 'dom_inv');
});

test('resolveDomainByIdOrLabel: id form and label form resolve to the SAME domain', () => {
  const byId = resolveDomainByIdOrLabel('dom_hr', DOMS, resolveDomain as never);
  const byLabel = resolveDomainByIdOrLabel('reimbursement quota', DOMS, resolveDomain as never);
  assert.ok(byId && byLabel);
  assert.equal(byId!.id, byLabel!.id);
  assert.equal(byId!.id, 'dom_hr');
});

test('resolveDomainByIdOrLabel returns null for an unknown ref (no-guess)', () => {
  assert.equal(resolveDomainByIdOrLabel('nope_xyz', DOMS, resolveDomain as never), null);
  assert.equal(resolveDomainByIdOrLabel('', DOMS, resolveDomain as never), null);
});

test('executeStep(connector-query) reads via a domain ID (the compiler convention)', async () => {
  const deps = fakeDeps({
    async listDomains() {
      return DOMS;
    },
    async queryDomain() {
      return { result: { rows: [{ id: 1 }], count: 1, dialect: 'sql' }, detail: 'read 1 row' };
    },
  });
  const s = spec([{ id: 'q', label: 'read invoices', kind: 'connector-query', domain: 'dom_inv' }]);
  const r = await executeStep(s, s.steps[0], [], { orgId: 'default', runId: 'r6' }, deps);
  assert.equal(r.status, 'done');
  assert.match(r.output ?? '', /Invoices/);
});

// ─── GAP #113 — an inline agent step (no agentId) materializes + runs ─────────────────────────────

test('executeStep(agent) materializes an inline agent then runs it (idempotent)', async () => {
  let created = 0;
  const deps = fakeDeps({
    async materializeAgent(_spec, step) {
      created += 1;
      step.agentId = 'ag_new';
      return 'ag_new';
    },
    async runAgent(agentId, query) {
      return { id: `run_${agentId}`, answer: `inline decided from: ${query}`, status: 'done', citations: [] };
    },
  });
  const s = spec([
    { id: 's1', label: 'decide', kind: 'agent', inlineAgent: { systemPrompt: 'Decide eligibility.', grounded: true } },
  ]);
  const r1 = await executeStep(s, s.steps[0], [], { orgId: 'default', runId: 'r7' }, deps);
  assert.equal(r1.status, 'done');
  assert.match(r1.output ?? '', /inline decided from:/);
  assert.equal(created, 1);
  // Idempotent: the id was cached back onto the step, so a re-run does NOT materialize again.
  const r2 = await executeStep(s, s.steps[0], [], { orgId: 'default', runId: 'r7' }, deps);
  assert.equal(r2.status, 'done');
  assert.equal(created, 1);
  assert.equal((s.steps[0] as { agentId?: string }).agentId, 'ag_new');
});

test('runApp runs a compiled-shaped app: connector(id)→inline-agent→human (materializes, pauses)', async () => {
  const deps = fakeDeps({
    async listDomains() {
      return DOMS;
    },
  });
  const s = spec(
    [
      { id: 's1', label: 'read invoices', kind: 'connector-query', domain: 'dom_inv' },
      { id: 's2', label: 'decide', kind: 'agent', inlineAgent: { systemPrompt: 'Decide.', grounded: true } },
      { id: 's3', label: 'review', kind: 'human' },
      { id: 's4', label: 'Output', kind: 'output', sink: 'console' },
    ],
    [{ from: 's1', to: 's2' }, { from: 's2', to: 's3' }, { from: 's3', to: 's4' }],
  );
  const out = await runApp(s, {}, { orgId: 'default', runId: 'r8' }, deps);
  assert.equal(out.status, 'awaiting_human');
  // The inline decision step actually ran (materialized) before the human pause.
  assert.equal(out.steps.find((x) => x.stepId === 's2')?.status, 'done');
  assert.equal((s.steps[1] as { agentId?: string }).agentId, 'ag_mat_s2');
});
