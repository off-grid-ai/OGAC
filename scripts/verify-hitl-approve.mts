// Behavioral verification of the HITL Approve loop-killer fix (G-HITL-1).
// Seeds a reimbursement app (agent → human → output), starts a run that pauses INLINE at the human
// step (durable worker OFF — the exact scenario that used to dead-end), then runs the SAME approve
// path the review route runs (signalAppRun → not_configured → rebuildAppRunState + resumeAppRun),
// and asserts the run COMPLETES with the output step executed. Prints a JSON verdict.
import './worker-env.mts';

// Do NOT clobber the gateway creds from .env.local (worker-env loads them). Only set if provided.
if (process.env.SEED_GATEWAY_URL) process.env.OFFGRID_GATEWAY_URL = process.env.SEED_GATEWAY_URL;
if (process.env.SEED_GATEWAY_KEY) process.env.OFFGRID_GATEWAY_API_KEY = process.env.SEED_GATEWAY_KEY;
delete process.env.OFFGRID_QUEUE_ENABLED;
delete process.env.OFFGRID_ADAPTER_APPRUNTIME;

const ORG = process.env.SEED_ORG ?? 'provit-hitl';
const OWNER = 'dev@offgrid.local';

const { createApp, publishApp, getApp } = await import('../src/lib/apps-store.ts');
const { submitAppRun, signalAppRun } = await import('../src/lib/adapters/apprun.ts');
const { newAppRunId, defaultDeps } = await import('../src/lib/app-run.ts');
const { getAppRunView } = await import('../src/lib/app-runs-view-reader.ts');
const { resumeAppRun } = await import('../src/lib/app-run-resume.ts');
const { rebuildAppRunState } = await import('../src/lib/app-run-plan.ts');

const app = await createApp(ORG, OWNER, {
  title: `HITL approve verify ${Date.now()}`,
  summary: 'Agent drafts, a manager approves, the decision is recorded.',
  visibility: 'private',
  trigger: { kind: 'on-demand' },
  inputForm: [{ key: 'claimAmount', label: 'Claim amount (INR)', type: 'number', required: true }],
  steps: [
    { id: 'draft', label: 'Draft recommendation', kind: 'agent',
      inlineAgent: { systemPrompt: 'Reply with exactly: RECOMMEND APPROVE.', model: 'qwythos-9b', grounded: false } },
    { id: 'approve', label: 'Manager approval', kind: 'human' },
    { id: 'emit', label: 'Record decision', kind: 'output', sink: 'console' },
  ],
  edges: [{ from: 'draft', to: 'approve' }, { from: 'approve', to: 'emit' }],
});
const spec = (await publishApp(app.id, ORG)) ?? app;

// 1. Start the run — it must pause INLINE at the human step.
const runId = newAppRunId();
const handle = await submitAppRun(spec, { claimAmount: 42000 }, { orgId: ORG, actor: OWNER, runId });
const before = await getAppRunView(runId, ORG);
if (!before) {
  console.log(JSON.stringify({ DEBUG: 'run view null after submit', handleMode: handle.mode, handleStatus: handle.status, handleNote: (handle as any).note, runId, org: ORG }, null, 2));
  process.exit(1);
}
const pausedOk = before?.status === 'awaiting_human' && before.steps.some((s) => s.id === 'approve' && s.status === 'awaiting_human');

// 2. Reproduce the review route's approve path EXACTLY.
const signal = await signalAppRun(spec.id, runId, { stepId: 'approve', decision: 'approve' });
// durable is OFF → signal reports not_configured; the route then resumes inline.
let resumedInline = false;
if (!signal.ok && (signal.reason === 'not_configured' || signal.reason === 'not_found')) {
  const loadedApp = await getApp(spec.id, ORG);
  const paused = rebuildAppRunState(before!.id, spec.id, before!.status, before!.steps);
  await resumeAppRun(
    loadedApp!, paused, before!.input ?? {},
    { decision: 'approve' },
    { orgId: ORG, actor: OWNER, runId },
    defaultDeps(),
  );
  resumedInline = true;
}

// 3. Read back — the run must have COMPLETED, output step run, no longer awaiting.
const after = await getAppRunView(runId, ORG);
const emit = after?.steps.find((s) => s.id === 'emit');
const stillAwaiting = after?.steps.some((s) => s.status === 'awaiting_human') ?? false;

const verdict = {
  org: ORG, appId: spec.id, runId,
  precondition_paused_at_human: pausedOk,
  signal_reason_when_durable_off: signal.reason ?? (signal.ok ? 'ok' : 'unknown'),
  resumed_inline: resumedInline,
  run_status_after_approve: after?.status,
  output_step_status: emit?.status,
  still_awaiting_human_after: stillAwaiting,
  PASS:
    pausedOk === true &&
    resumedInline === true &&
    after?.status === 'done' &&
    emit?.status === 'done' &&
    stillAwaiting === false,
};
console.log(JSON.stringify(verdict, null, 2));
process.exit(verdict.PASS ? 0 : 1);
