import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppSpec } from '@/lib/app-model';
import {
  initState,
  rebuildAppRunState,
  type PersistedStepRow,
} from '@/lib/app-run-plan';
import { type AppRunDeps, runApp, type StepResult } from '@/lib/app-run';
import { resumeAppRun, priorResultsFromState, stepResultFromState } from '@/lib/app-run-resume';

// ─── Fixtures — a spec factory + fake deps (real logic, only the two external boundaries faked) ────

function spec(steps: AppSpec['steps'], edges: AppSpec['edges'] = []): AppSpec {
  return {
    id: 'app1', orgId: 'default', ownerId: 'u1', title: 'T', summary: '', visibility: 'private',
    published: false, trigger: { kind: 'on-demand' }, steps, edges,
  };
}

// agent → human → output — the canonical HITL shape.
const HITL = spec(
  [
    { id: 's1', label: 'decide', kind: 'agent', agentId: 'ag1' },
    { id: 's2', label: 'review', kind: 'human' },
    { id: 's3', label: 'Output', kind: 'output', sink: 'console' },
  ],
  [{ from: 's1', to: 's2' }, { from: 's2', to: 's3' }],
);

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
      step.agentId = `ag_mat_${step.id}`;
      return step.agentId;
    },
    async renderReport(view, format) {
      return {
        filename: `r-${view.id}.${format}`,
        contentType: 'application/pdf',
        bytes: new Uint8Array(),
        manifest: { algorithm: 'ed25519', sha256: 'a'.repeat(64), signature: 'sig' },
      };
    },
    async sendEmail() {
      return { ok: false, configured: false, reason: 'test: SMTP not configured' };
    },
    ...over,
  };
}

// Run a spec inline to its human pause, capturing every persisted state so we can feed the LAST one
// (the paused row) back into resume — exactly what the route does after reading the stored row.
async function runToPause(s: AppSpec, over: Partial<AppRunDeps> = {}) {
  const persisted: { steps: PersistedStepRow[]; status: string }[] = [];
  const deps = fakeDeps({
    async persist(state) {
      persisted.push({
        status: state.status,
        steps: state.steps.map((st) => ({
          id: st.id, kind: st.kind, label: st.label, status: st.status,
          outcome: st.output, refs: (st.refs ?? []).map((r) => r.name),
          detail: st.detail, childRunId: st.childRunId,
        })),
      });
    },
    ...over,
  });
  const out = await runApp(s, { amount: 1000 }, { orgId: 'default', runId: 'r1' }, deps);
  const last = persisted[persisted.length - 1];
  return { out, row: last };
}

test('approve resumes an agent→human→output spec inline: the output step runs after approval', async () => {
  const { out, row } = await runToPause(HITL);
  assert.equal(out.status, 'awaiting_human');
  // The output step did NOT run at the pause.
  assert.equal(out.steps.find((x) => x.stepId === 's3'), undefined);

  const paused = rebuildAppRunState('r1', 'app1', row.status, row.steps);
  assert.equal(paused.status, 'awaiting_human');

  const resumed = await resumeAppRun(
    HITL, paused, { amount: 1000 }, { decision: 'approve' },
    { orgId: 'default', runId: 'r1' }, fakeDeps(),
  );
  assert.equal(resumed.status, 'done');
  // The human step is done, and the downstream output step ACTUALLY ran after approval.
  assert.equal(resumed.steps.find((x) => x.stepId === 's2')?.status, 'done');
  const output = resumed.steps.find((x) => x.stepId === 's3');
  assert.ok(output, 'output step ran after approval');
  assert.equal(output?.status, 'done');
});

test('approve with an edited output carries the operator edit forward as the human step output', async () => {
  const { row } = await runToPause(HITL);
  const paused = rebuildAppRunState('r1', 'app1', row.status, row.steps);
  const resumed = await resumeAppRun(
    HITL, paused, { amount: 1000 },
    { decision: 'approve', output: 'APPROVED: pay 800 not 1000', note: 'partial' },
    { orgId: 'default', runId: 'r1' }, fakeDeps(),
  );
  assert.equal(resumed.status, 'done');
  const human = resumed.steps.find((x) => x.stepId === 's2');
  assert.equal(human?.output, 'APPROVED: pay 800 not 1000');
  assert.match(human?.detail ?? '', /approved by reviewer/);
  assert.match(human?.detail ?? '', /note: partial/);
  // The edited output is the latest non-empty output → it flows to the console sink as the outcome.
  assert.match(resumed.outcome, /APPROVED: pay 800 not 1000/);
});

test('reject finalizes the run non-success (cancelled) and does NOT run downstream steps', async () => {
  const { row } = await runToPause(HITL);
  const paused = rebuildAppRunState('r1', 'app1', row.status, row.steps);
  const resumed = await resumeAppRun(
    HITL, paused, { amount: 1000 }, { decision: 'reject', note: 'not eligible' },
    { orgId: 'default', runId: 'r1' }, fakeDeps(),
  );
  assert.equal(resumed.status, 'cancelled');
  // The output step must NOT be present — no downstream step ran on a reject.
  assert.equal(resumed.steps.find((x) => x.stepId === 's3'), undefined);
});

test('approve pauses AGAIN at a second human step (does not overrun the next HITL gate)', async () => {
  const twoHuman = spec(
    [
      { id: 's1', label: 'decide', kind: 'agent', agentId: 'ag1' },
      { id: 's2', label: 'first review', kind: 'human' },
      { id: 's3', label: 'refine', kind: 'agent', agentId: 'ag2' },
      { id: 's4', label: 'second review', kind: 'human' },
      { id: 's5', label: 'Output', kind: 'output', sink: 'console' },
    ],
    [
      { from: 's1', to: 's2' }, { from: 's2', to: 's3' },
      { from: 's3', to: 's4' }, { from: 's4', to: 's5' },
    ],
  );
  const { out, row } = await runToPause(twoHuman);
  assert.equal(out.status, 'awaiting_human');

  const paused = rebuildAppRunState('r1', 'app1', row.status, row.steps);
  const resumed = await resumeAppRun(
    twoHuman, paused, { amount: 1000 }, { decision: 'approve' },
    { orgId: 'default', runId: 'r1' }, fakeDeps(),
  );
  // Approving the FIRST human step runs the middle agent, then pauses at the SECOND human step.
  assert.equal(resumed.status, 'awaiting_human');
  assert.equal(resumed.steps.find((x) => x.stepId === 's2')?.status, 'done');
  assert.equal(resumed.steps.find((x) => x.stepId === 's3')?.status, 'done');
  assert.equal(resumed.steps.find((x) => x.stepId === 's4')?.status, 'awaiting_human');
  // The final output step has NOT run — the second gate holds it.
  assert.equal(resumed.steps.find((x) => x.stepId === 's5'), undefined);
});

test('a downstream agent after approval sees the upstream + approved outputs threaded in as context', async () => {
  let seenQuery = '';
  const twoAgent = spec(
    [
      { id: 's1', label: 'decide', kind: 'agent', agentId: 'ag1' },
      { id: 's2', label: 'review', kind: 'human' },
      { id: 's3', label: 'summarize', kind: 'agent', agentId: 'ag2' },
    ],
    [{ from: 's1', to: 's2' }, { from: 's2', to: 's3' }],
  );
  const { row } = await runToPause(twoAgent);
  const paused = rebuildAppRunState('r1', 'app1', row.status, row.steps);
  const resumed = await resumeAppRun(
    twoAgent, paused, { amount: 1000 },
    { decision: 'approve', output: 'REVIEWER SAYS OK' },
    { orgId: 'default', runId: 'r1' },
    fakeDeps({
      async runAgent(agentId, query) {
        if (agentId === 'ag2') seenQuery = query;
        return { id: `run_${agentId}`, answer: `done ${agentId}`, status: 'done', citations: [] };
      },
    }),
  );
  assert.equal(resumed.status, 'done');
  // The downstream agent's query carried BOTH the first agent's output AND the reviewer's decision.
  assert.match(seenQuery, /CONTEXT FROM PRIOR STEPS/);
  assert.match(seenQuery, /REVIEWER SAYS OK/);
});

test('resumeAppRun is a no-op finalize when the run is not paused at a human step (defensive)', async () => {
  // A fully-queued state (nothing awaiting) → resume finalizes without running anything.
  const state = initState(HITL, 'r1');
  const out = await resumeAppRun(
    HITL, state, {}, { decision: 'approve' }, { orgId: 'default', runId: 'r1' }, fakeDeps(),
  );
  // No awaiting step → returns current (queued → treated as done), no steps executed.
  assert.equal(out.steps.length, 0);
});

// ─── rebuildAppRunState — the pure inverse of app-run-store.toRowSteps ─────────────────────────────

test('rebuildAppRunState maps a persisted row back to AppRunState (outcome→output, refs→{name})', () => {
  const rows: PersistedStepRow[] = [
    { id: 's1', kind: 'agent', label: 'decide', status: 'done', outcome: 'ans', refs: ['a:b'], detail: 'd' },
    { id: 's2', kind: 'human', label: 'review', status: 'awaiting_human' },
    { id: 's3', kind: 'output', label: 'Output', status: 'queued' },
  ];
  const state = rebuildAppRunState('r9', 'app1', 'awaiting_human', rows);
  assert.equal(state.status, 'awaiting_human');
  const s1 = state.steps.find((s) => s.id === 's1');
  assert.equal(s1?.output, 'ans');
  assert.deepEqual(s1?.refs, [{ name: 'a:b' }]);
});

test('rebuildAppRunState preserves an explicit cancelled status (reducer never derives it)', () => {
  const rows: PersistedStepRow[] = [
    { id: 's1', kind: 'agent', label: 'decide', status: 'done' },
    { id: 's2', kind: 'human', label: 'review', status: 'error', detail: 'rejected' },
  ];
  const state = rebuildAppRunState('r9', 'app1', 'cancelled', rows);
  assert.equal(state.status, 'cancelled');
});

test('rebuildAppRunState defends against an unknown per-step status (falls back to queued)', () => {
  const rows: PersistedStepRow[] = [{ id: 's1', kind: 'agent', label: 'x', status: 'bogus' }];
  const state = rebuildAppRunState('r9', 'app1', 'running', rows);
  assert.equal(state.steps[0].status, 'queued');
});

test('priorResultsFromState / stepResultFromState project only DONE steps into StepResults', () => {
  const rows: PersistedStepRow[] = [
    { id: 's1', kind: 'agent', label: 'decide', status: 'done', outcome: 'a', childRunId: 'c1' },
    { id: 's2', kind: 'human', label: 'review', status: 'awaiting_human' },
  ];
  const state = rebuildAppRunState('r9', 'app1', 'awaiting_human', rows);
  const results: StepResult[] = priorResultsFromState(state);
  assert.equal(results.length, 1);
  assert.equal(results[0].stepId, 's1');
  assert.equal(results[0].childRunId, 'c1');

  const one = stepResultFromState(state.steps[0]);
  assert.equal(one.status, 'done');
  assert.equal(one.output, 'a');
});
