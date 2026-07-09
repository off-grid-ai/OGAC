// One-off seed for the Provit HITL verification.
// Creates a reimbursement-style app (agent → human → output) under a UNIQUE org
// (provit-hitl) and starts a run that pauses at the human step (inline path,
// durable worker OFF). Prints appId + runId + status as JSON on the last line.
//
// Import order load-bearing: worker-env first so .env.local is loaded before @/db.
import './worker-env.mts';

// Force the on-prem gateway for the agent step (local aggregator isn't running).
process.env.OFFGRID_GATEWAY_URL = process.env.SEED_GATEWAY_URL ?? 'https://ai.getoffgridai.co';
process.env.OFFGRID_GATEWAY_API_KEY = process.env.SEED_GATEWAY_KEY ?? '';
// Ensure durable dispatch is OFF so the run executes INLINE and pauses at the human step.
delete process.env.OFFGRID_QUEUE_ENABLED;
delete process.env.OFFGRID_ADAPTER_APPRUNTIME;

const ORG = process.env.SEED_ORG ?? 'provit-hitl';

const { createApp, publishApp } = await import('../src/lib/apps-store.ts');
const { submitAppRun } = await import('../src/lib/adapters/apprun.ts');
const { newAppRunId } = await import('../src/lib/app-run.ts');
const { getAppRunView } = await import('../src/lib/app-runs-view-reader.ts');

const OWNER = 'dev@offgrid.local';
const title = `Reimbursement approval (Provit HITL ${Date.now()})`;

const app = await createApp(ORG, OWNER, {
  title,
  summary: 'Employee reimbursement claim: an agent drafts a recommendation, a manager approves, then the decision is emitted.',
  visibility: 'private',
  trigger: { kind: 'on-demand' },
  inputForm: [
    { key: 'employeeId', label: 'Employee ID', type: 'text', required: true },
    { key: 'claimAmount', label: 'Claim amount (INR)', type: 'number', required: true },
  ],
  steps: [
    {
      id: 'draft',
      label: 'Draft recommendation',
      kind: 'agent',
      inlineAgent: {
        systemPrompt:
          'You review employee reimbursement claims for an Indian insurer. Given the claim, write ONE short sentence recommending approve or flag-for-review. Do not include any personal identifiers.',
        model: 'qwythos-9b',
        grounded: false,
      },
    },
    { id: 'approve', label: 'Manager approval', kind: 'human' },
    { id: 'emit', label: 'Record decision', kind: 'output', sink: 'console' },
  ],
  edges: [
    { from: 'draft', to: 'approve' },
    { from: 'approve', to: 'emit' },
  ],
});

const published = await publishApp(app.id, ORG);
const spec = published ?? app;

const runId = newAppRunId();
const handle = await submitAppRun(
  spec,
  { employeeId: 'EMP00002', claimAmount: 25000 },
  { orgId: ORG, actor: OWNER, runId },
);

// Read back the persisted run view to confirm its real status.
const view = await getAppRunView(runId, ORG);
const awaitingStep = view?.steps.find((s) => s.status === 'awaiting_human');

console.log(
  JSON.stringify(
    {
      org: ORG,
      appId: app.id,
      runId,
      title,
      handleMode: handle.mode,
      handleStatus: handle.status,
      viewStatus: view?.status,
      awaitingStepId: awaitingStep?.id,
      steps: view?.steps.map((s) => ({ id: s.id, kind: s.kind, status: s.status })),
    },
    null,
    2,
  ),
);
process.exit(0);
