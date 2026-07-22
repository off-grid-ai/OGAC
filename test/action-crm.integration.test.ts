import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { test } from 'node:test';

import { executeCrmAction, type ActionExecutionContext } from '@/lib/adapters/action-crm';
import { CRM_TASK_API_VERSION } from '@/lib/adapters/crm-task-writeback';
import { getSigning } from '@/lib/adapters/registry';
import type { ActionStepShape } from '@/lib/action-contract';

const CONTEXT: ActionExecutionContext = {
  orgId: 'org_bharat',
  runId: 'apprun_cross_sell_101',
  stepId: 'create-follow-up',
  approval: {
    stepId: 'rm-review',
    evidence: 'approved by reviewer — note: eligible offer confirmed',
  },
  now: () => new Date('2026-07-22T12:00:00.000Z'),
};

const CREATE: ActionStepShape = {
  id: 'create-follow-up',
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
    dueAt: '2026-07-23T09:00:00.000Z',
    assignee: 'relationship-manager@example.test',
  },
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

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

test('maker-checker blocks the CRM boundary before any side effect', async () => {
  let requests = 0;
  const server = createServer((_req, res) => {
    requests += 1;
    json(res, 500, {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const connector = {
      id: 'crm_bharat',
      type: 'rest',
      endpoint: `http://127.0.0.1:${address.port}`,
    };
    const absent = await executeCrmAction(connector, CREATE, { ...CONTEXT, approval: undefined });
    assert.equal(absent.ok, false);
    if (!absent.ok) assert.equal(absent.code, 'approval-required');

    const wrongStep = await executeCrmAction(connector, CREATE, {
      ...CONTEXT,
      approval: { stepId: 'other-review', evidence: 'approved by reviewer' },
    });
    assert.equal(wrongStep.ok, false);
    if (!wrongStep.ok) assert.equal(wrongStep.code, 'approval-required');

    const rejected = await executeCrmAction(connector, CREATE, {
      ...CONTEXT,
      approval: { stepId: 'rm-review', evidence: 'rejected by reviewer' },
    });
    assert.equal(rejected.ok, false);
    assert.equal(requests, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('generic action creates and replays a tenant-scoped CRM task through real HTTP', async (t) => {
  const ledger = new Map<string, { hash: string; task: Record<string, unknown> }>();
  const seenOrgs: string[] = [];
  let writes = 0;
  const server = createServer(async (req, res) => {
    const org = String(req.headers['x-offgrid-org-id'] ?? '');
    seenOrgs.push(org);
    const body = await readJson(req);
    const key = `${org}:${String(body.idempotencyKey)}`;
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const prior = ledger.get(key);
    const headers = { 'x-offgrid-crm-api-version': CRM_TASK_API_VERSION };
    if (prior) {
      if (prior.hash !== hash) return json(res, 409, { error: 'conflict' }, headers);
      return json(
        res,
        200,
        { apiVersion: CRM_TASK_API_VERSION, task: prior.task, replayed: true },
        { ...headers, 'x-idempotent-replay': 'true' },
      );
    }
    writes += 1;
    const task = { id: 'task_0123456789abcdef', orgId: org, ...body };
    ledger.set(key, { hash, task });
    return json(res, 201, { apiVersion: CRM_TASK_API_VERSION, task, replayed: false }, headers);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const connector = {
    id: 'crm_bharat',
    type: 'rest',
    endpoint: `http://127.0.0.1:${address.port}`,
  };

  const created = await executeCrmAction(connector, CREATE, CONTEXT);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.receipt.status, 'executed');
  assert.equal(created.receipt.orgId, 'org_bharat');
  assert.equal(created.receipt.target, 'opp_101');
  assert.deepEqual(created.receipt.approval, CONTEXT.approval);
  assert.equal(created.impact.egress.dataLeavesOrganisation, false);
  assert.equal(created.resource.orgId, 'org_bharat');
  const provider = created.receipt.providerReceipt;
  const { signature, algorithm: _algorithm, publicKey: _publicKey, ...signed } = provider;
  assert.equal(getSigning().verify(signed, String(signature)), true);

  const replay = await executeCrmAction(connector, CREATE, CONTEXT);
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.receipt.status, 'replayed');
  assert.equal(writes, 1);
  assert.deepEqual(seenOrgs, ['org_bharat', 'org_bharat']);

  const independent = await executeCrmAction(connector, CREATE, {
    ...CONTEXT,
    runId: 'apprun_cross_sell_102',
  });
  assert.equal(independent.ok, true);
  if (independent.ok) {
    assert.equal(independent.receipt.status, 'executed');
    assert.notEqual(independent.receipt.idempotencyKey, created.receipt.idempotencyKey);
  }
  assert.equal(writes, 2, 'a different run owns an independent action');

  const conflict = await executeCrmAction(
    connector,
    { ...CREATE, command: { ...CREATE.command, subject: 'Different command' } },
    CONTEXT,
  );
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.code, 'idempotency-conflict');
  assert.equal(writes, 2);
});

test('generic action updates a CRM opportunity through its existing signed adapter', async (t) => {
  let record: Record<string, unknown> = { id: 'opp_202', stage: 'qualification' };
  const seenMethods: string[] = [];
  const server = createServer(async (req, res) => {
    seenMethods.push(String(req.method));
    if (req.method === 'GET') return json(res, 200, record);
    const patch = await readJson(req);
    record = { ...record, ...patch };
    return json(res, 200, record);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const step: ActionStepShape = {
    id: 'update-opportunity',
    kind: 'action',
    actionId: 'crm.update-opportunity',
    connectorId: 'crm_bharat',
    approvalStepId: 'rm-review',
    command: {
      opportunityId: 'opp_202',
      useCase: 'bank-cross-sell',
      followUp: { kind: 'meeting', summary: 'Present approved offer' },
      stage: 'proposal',
    },
  };
  const result = await executeCrmAction(
    { id: 'crm_bharat', type: 'rest', endpoint: `http://127.0.0.1:${address.port}` },
    step,
    { ...CONTEXT, stepId: step.id },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.resource.stage, 'proposal');
    assert.equal(result.receipt.target, 'opp_202');
  }
  assert.deepEqual(seenMethods, ['GET', 'PATCH']);
});

test('action errors remain bounded and unsupported catalogue entries do not fabricate impact', async () => {
  const connector = { id: 'crm', type: 'rest', endpoint: 'http://127.0.0.1:1' };
  const invalid = await executeCrmAction(connector, { ...CREATE, command: {} }, CONTEXT);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, 'invalid-command');

  const unsupported = await executeCrmAction(
    connector,
    { ...CREATE, actionId: 'http.request' as never },
    CONTEXT,
  );
  assert.deepEqual(unsupported, {
    ok: false,
    code: 'unsupported-action',
    message: 'This action is not available in the governed catalogue.',
  });

  const unavailable = await executeCrmAction(connector, CREATE, CONTEXT);
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) {
    assert.equal(unavailable.code, 'unsupported-connector');
    assert.equal(unavailable.message.length < 200, true);
  }
});

test('the real HTTP action boundary times out with a bounded useful failure', async (t) => {
  const server = createServer(() => {
    // Deliberately never respond: execRestConnectorRequest owns the five-second abort boundary.
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const started = Date.now();
  const result = await executeCrmAction(
    { id: 'crm', type: 'rest', endpoint: `http://127.0.0.1:${address.port}` },
    CREATE,
    CONTEXT,
  );
  const elapsed = Date.now() - started;
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'unsupported-connector');
    assert.equal(result.message, 'connector is not a reachable REST source');
  }
  assert.equal(elapsed >= 4_500 && elapsed < 7_000, true, `bounded at ${elapsed}ms`);
});
