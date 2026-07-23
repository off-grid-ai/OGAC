import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { test } from 'node:test';

import { CRM_TASK_API_VERSION } from '@/lib/adapters/crm-task-writeback';
import type { ActionStep, AppSpec } from '@/lib/app-model';
import { defaultDeps } from '@/lib/app-run';
import { resumeAppRun, stepResultFromState } from '@/lib/app-run-resume';
import {
  applyStepResult,
  initState,
  rebuildAppRunState,
  type AppRunState,
  type PersistedStepRow,
} from '@/lib/app-run-plan';

const ACTION: ActionStep = {
  id: 'act',
  label: 'Create approved follow-up',
  kind: 'action',
  actionId: 'crm.create-task',
  connectorId: 'crm_bharat',
  approvalStepId: 'review',
  command: {
    subject: 'Call eligible customer',
    useCase: 'bank-cross-sell',
    kind: 'call',
    opportunityId: 'opp_101',
  },
};

const SPEC: AppSpec = {
  id: 'app',
  orgId: 'org_bharat',
  ownerId: 'maker',
  title: 'Cross-sell',
  summary: '',
  visibility: 'private',
  published: false,
  trigger: { kind: 'on-demand' },
  steps: [{ id: 'review', label: 'RM review', kind: 'human' }, ACTION],
  edges: [{ from: 'review', to: 'act' }],
};

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

// Validates the LIVE approved-action path; opt in to the global live-action gate (OFF-by-default,
// covered by app-run-controls.test.ts).
process.env.OFFGRID_ALLOW_LIVE_ACTIONS = '1';

test('approved inline action persists impact and signed receipt through the existing run trace', async (t) => {
  const server = createServer(async (req, res) => {
    const body = await readJson(req);
    res.writeHead(201, {
      'content-type': 'application/json',
      'x-offgrid-crm-api-version': CRM_TASK_API_VERSION,
    });
    res.end(
      JSON.stringify({
        apiVersion: CRM_TASK_API_VERSION,
        replayed: false,
        task: { id: 'task_0123456789abcdef', orgId: req.headers['x-offgrid-org-id'], ...body },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const persisted: AppRunState[] = [];
  const deps = {
    ...defaultDeps(),
    getConnector: async () => ({
      id: 'crm_bharat',
      type: 'rest',
      endpoint: `http://127.0.0.1:${address.port}`,
    }),
    persist: async (state: AppRunState) => {
      persisted.push(structuredClone(state));
    },
  };
  const queued = initState(SPEC, 'run_101');
  const paused = applyStepResult(queued, 'review', {
    status: 'awaiting_human',
    output: 'Eligible customer',
  });
  const outcome = await resumeAppRun(
    SPEC,
    paused,
    {},
    {
      decision: 'approve',
      note: 'customer consent confirmed',
      reviewer: 'priya.manager@bharat.local',
    },
    { orgId: 'org_bharat', runId: 'run_101', mode: 'live' },
    deps,
  );
  assert.equal(outcome.status, 'done');
  const actionResult = outcome.steps.find((step) => step.stepId === 'act');
  assert.equal(actionResult?.actionReceipt?.status, 'executed');
  assert.equal(actionResult?.actionReceipt?.approval.reviewer, 'priya.manager@bharat.local');
  assert.equal(actionResult?.actionImpact?.egress.dataLeavesOrganisation, false);

  const final = persisted.at(-1)!;
  const actionState = final.steps.find((step) => step.id === 'act')!;
  assert.equal(actionState.actionReceipt?.runId, 'run_101');
  assert.equal(actionState.actionImpact?.target, 'opp_101');
  assert.equal(stepResultFromState(actionState).actionReceipt?.status, 'executed');

  const rows: PersistedStepRow[] = final.steps.map((step) => ({
    ...step,
    outcome: step.output,
  }));
  const rebuilt = rebuildAppRunState(final.runId, final.appId, final.status, rows);
  assert.deepEqual(
    rebuilt.steps.find((step) => step.id === 'act')?.actionReceipt,
    actionState.actionReceipt,
  );
  assert.deepEqual(
    rebuilt.steps.find((step) => step.id === 'act')?.actionImpact,
    actionState.actionImpact,
  );
});

test('durable human resolution projects authenticated reviewer identity', async () => {
  const { resolveHumanStep } = await import('@/worker/app-run.workflow');
  const result = resolveHumanStep(
    { id: 'review', label: 'RM review', kind: 'human' },
    {
      stepId: 'review',
      decision: 'approve',
      reviewer: 'priya.manager@bharat.local',
      note: 'eligible offer confirmed',
    },
    { stepId: 'review', kind: 'human', status: 'awaiting_human' },
  );
  assert.equal(result.status, 'done');
  assert.equal(result.reviewer, 'priya.manager@bharat.local');
  assert.match(result.detail ?? '', /human approved/);
});
