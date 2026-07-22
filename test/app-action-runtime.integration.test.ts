import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { test } from 'node:test';

import { CRM_TASK_API_VERSION } from '@/lib/adapters/crm-task-writeback';
import type { ActionStep, AppSpec } from '@/lib/app-model';
import { defaultDeps, executeStep, type StepResult } from '@/lib/app-run';

const ACTION: ActionStep = {
  id: 'create-follow-up',
  label: 'Create the approved CRM follow-up',
  kind: 'action',
  actionId: 'crm.create-task',
  connectorId: 'crm_bharat',
  approvalStepId: 'rm-review',
  command: {
    operation: 'create-task',
    subject: 'Discuss the approved next-best offer',
    useCase: 'bank-cross-sell',
    kind: 'call',
    opportunityId: 'opp_101',
  },
};

const SPEC: AppSpec = {
  id: 'app_cross_sell',
  orgId: 'org_bharat',
  ownerId: 'maker',
  title: 'Cross-sell follow-up',
  summary: '',
  visibility: 'private',
  published: false,
  trigger: { kind: 'on-demand' },
  steps: [{ id: 'rm-review', label: 'RM review', kind: 'human' }, ACTION],
  edges: [{ from: 'rm-review', to: ACTION.id }],
};

const APPROVED: StepResult[] = [
  {
    stepId: 'rm-review',
    kind: 'human',
    status: 'done',
    output: 'Eligible customer; approved for follow-up.',
    detail: 'approved by reviewer — note: customer consent confirmed',
  },
];

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

function json(res: ServerResponse, status: number, body: unknown, replay = false): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'x-offgrid-crm-api-version': CRM_TASK_API_VERSION,
    'x-idempotent-replay': replay ? 'true' : 'false',
  });
  res.end(JSON.stringify(body));
}

test('shadow action returns a bounded impact preview and makes zero CRM requests', async (t) => {
  let requests = 0;
  const server = createServer((_req, res) => {
    requests += 1;
    json(res, 500, {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const deps = {
    ...defaultDeps(),
    getConnector: async () => ({
      id: 'crm_bharat',
      type: 'rest',
      endpoint: `http://127.0.0.1:${address.port}`,
    }),
  };
  const result = await executeStep(
    SPEC,
    ACTION,
    APPROVED,
    { orgId: 'org_bharat', runId: 'run_shadow', mode: 'shadow' },
    deps,
  );
  assert.equal(result.status, 'done');
  assert.equal(result.actionReceipt, undefined);
  assert.equal(result.actionImpact?.summary.includes('Nothing has been changed.'), false);
  assert.equal(result.actionImpact?.egress.dataLeavesOrganisation, false);
  assert.match(result.detail ?? '', /^SHADOW:/);
  assert.equal(requests, 0);
});

test('live action cannot execute before its exact approved human step', async (t) => {
  let requests = 0;
  const server = createServer((_req, res) => {
    requests += 1;
    json(res, 500, {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const deps = {
    ...defaultDeps(),
    getConnector: async () => ({
      id: 'crm_bharat',
      type: 'rest',
      endpoint: `http://127.0.0.1:${address.port}`,
    }),
  };
  const result = await executeStep(
    SPEC,
    ACTION,
    [{ ...APPROVED[0], stepId: 'other-review' }],
    { orgId: 'org_bharat', runId: 'run_blocked', mode: 'live' },
    deps,
  );
  assert.equal(result.status, 'error');
  assert.match(result.detail ?? '', /different person must approve/);
  assert.equal(requests, 0);
});

test('live App action executes the real tenant-scoped adapter and returns its receipt', async (t) => {
  const ledger = new Map<string, { hash: string; task: Record<string, unknown> }>();
  const keys: string[] = [];
  const server = createServer(async (req, res) => {
    const org = String(req.headers['x-offgrid-org-id'] ?? '');
    const body = await readJson(req);
    const key = `${org}:${String(body.idempotencyKey)}`;
    keys.push(String(body.idempotencyKey));
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const prior = ledger.get(key);
    if (prior) {
      if (prior.hash !== hash) return json(res, 409, { error: 'conflict' });
      return json(
        res,
        200,
        { apiVersion: CRM_TASK_API_VERSION, task: prior.task, replayed: true },
        true,
      );
    }
    const task = { id: 'task_0123456789abcdef', orgId: org, ...body };
    ledger.set(key, { hash, task });
    return json(res, 201, { apiVersion: CRM_TASK_API_VERSION, task, replayed: false });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const deps = {
    ...defaultDeps(),
    getConnector: async (id: string, org: string) => {
      assert.equal(id, 'crm_bharat');
      assert.equal(org, 'org_bharat');
      return {
        id,
        type: 'rest',
        endpoint: `http://127.0.0.1:${address.port}`,
      };
    },
  };
  const context = { orgId: 'org_bharat', runId: 'run_live_1', mode: 'live' as const };
  const first = await executeStep(SPEC, ACTION, APPROVED, context, deps);
  assert.equal(first.status, 'done');
  assert.equal(first.actionReceipt?.status, 'executed');
  assert.equal(first.actionReceipt?.orgId, 'org_bharat');
  assert.deepEqual(first.actionReceipt?.approval, {
    stepId: 'rm-review',
    evidence: APPROVED[0].detail,
  });
  assert.match(first.detail ?? '', /receipt retained/);

  const replay = await executeStep(SPEC, ACTION, APPROVED, context, deps);
  assert.equal(replay.actionReceipt?.status, 'replayed');
  const independent = await executeStep(
    SPEC,
    ACTION,
    APPROVED,
    { ...context, runId: 'run_live_2' },
    deps,
  );
  assert.equal(independent.actionReceipt?.status, 'executed');
  assert.equal(ledger.size, 2);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[1], keys[2]);
});
