import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { test } from 'node:test';

import { writeCrmTask, CRM_TASK_API_VERSION } from '@/lib/adapters/crm-task-writeback';
import { getSigning } from '@/lib/adapters/registry';
import { buildCrmTaskSourceRequest, validateCrmTaskCommand } from '@/lib/crm-task-writeback';

const CREATE_COMMAND = {
  operation: 'create-task',
  idempotencyKey: 'delinquency:loan-001:v1',
  subject: 'Call borrower about the overdue instalment',
  useCase: 'lender-delinquency',
  kind: 'call',
  opportunityId: 'opp_loan_001',
  dueAt: '2026-07-21T09:00:00.000Z',
  assignee: 'collections@example.test',
} as const;

test('CRM task commands are bounded and map only to the versioned task resource', () => {
  const valid = validateCrmTaskCommand(CREATE_COMMAND);
  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.deepEqual(buildCrmTaskSourceRequest(valid.value), {
    method: 'POST', path: ['v1', 'tasks'],
    body: {
      idempotencyKey: CREATE_COMMAND.idempotencyKey,
      subject: CREATE_COMMAND.subject,
      useCase: CREATE_COMMAND.useCase,
      kind: CREATE_COMMAND.kind,
      status: 'open',
      opportunityId: CREATE_COMMAND.opportunityId,
      dueAt: CREATE_COMMAND.dueAt,
      assignee: CREATE_COMMAND.assignee,
    },
  });

  const unsafe = validateCrmTaskCommand({ ...CREATE_COMMAND, path: '/admin', arbitrary: true });
  assert.equal(unsafe.ok, false);
  if (!unsafe.ok) assert.deepEqual(unsafe.errors, ['create-task contains unsupported fields']);

  const unsafeUpdate = validateCrmTaskCommand({
    operation: 'update-task', taskId: '../task', idempotencyKey: 'update-task-001',
    patch: { status: 'deleted', arbitrary: true },
  });
  assert.equal(unsafeUpdate.ok, false);
  if (!unsafeUpdate.ok) assert.deepEqual(unsafeUpdate.errors, [
    'taskId must be a versioned CRM task id',
    'patch contains unsupported fields',
    'patch.status must be one of: open, in_progress, completed, cancelled',
    'patch must change at least one field',
  ]);
});

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown, replayed = false): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'x-offgrid-crm-api-version': CRM_TASK_API_VERSION,
    'x-idempotent-replay': replayed ? 'true' : 'false',
  });
  res.end(JSON.stringify(body));
}

test('CRM task adapter creates, updates, replays, scopes, and signs through real HTTP', async (t) => {
  const tasks = new Map<string, Record<string, unknown>>();
  const ledger = new Map<string, { hash: string; task: Record<string, unknown> }>();
  const seenOrgs: string[] = [];
  const server = createServer(async (req, res) => {
    const org = String(req.headers['x-offgrid-org-id'] ?? '');
    seenOrgs.push(org);
    const body = await readJson(req);
    const commandHash = createHash('sha256').update(JSON.stringify({ url: req.url, org, body })).digest('hex');
    const key = `${org}:${String(body.idempotencyKey)}`;
    const prior = ledger.get(key);
    if (prior) {
      if (prior.hash !== commandHash) return json(res, 409, { error: 'idempotency conflict' });
      return json(res, 200, { apiVersion: CRM_TASK_API_VERSION, task: prior.task, replayed: true }, true);
    }
    if (req.method === 'POST' && req.url === '/v1/tasks') {
      const task = { id: 'task_0123456789abcdef', orgId: org, ...body, createdAt: '2026-07-20T12:00:00.000Z' };
      tasks.set(String(task.id), task);
      ledger.set(key, { hash: commandHash, task });
      return json(res, 201, { apiVersion: CRM_TASK_API_VERSION, task, replayed: false });
    }
    const taskId = req.url?.split('/').at(-1) ?? '';
    const current = tasks.get(taskId);
    if (req.method === 'PATCH' && current && current.orgId === org) {
      const task = { ...current, ...(body.patch as Record<string, unknown>), updatedAt: '2026-07-20T12:00:00.000Z' };
      tasks.set(taskId, task);
      ledger.set(key, { hash: commandHash, task });
      return json(res, 200, { apiVersion: CRM_TASK_API_VERSION, task, replayed: false });
    }
    return json(res, 404, { error: 'not found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const connector = { id: 'crm_bharat', type: 'rest', endpoint: `http://127.0.0.1:${address.port}` };
  const clock = () => new Date('2026-07-20T12:00:00.000Z');

  const created = await writeCrmTask(connector, CREATE_COMMAND, 'org_bharat', clock);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.receipt.replayed, false);
  assert.equal(created.receipt.apiVersion, CRM_TASK_API_VERSION);
  assert.equal(created.task.orgId, 'org_bharat');
  const signing = getSigning();
  const { signature, algorithm: _algorithm, publicKey: _publicKey, ...signed } = created.receipt;
  assert.equal(signing.verify(signed, signature), true);

  const replay = await writeCrmTask(connector, CREATE_COMMAND, 'org_bharat', clock);
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.receipt.replayed, true);

  const update = {
    operation: 'update-task', taskId: created.receipt.taskId,
    idempotencyKey: 'delinquency:loan-001:done', patch: { status: 'completed' },
  } as const;
  const updated = await writeCrmTask(connector, update, 'org_bharat', clock);
  assert.equal(updated.ok, true);
  if (updated.ok) assert.equal(updated.task.status, 'completed');
  assert.deepEqual(seenOrgs, ['org_bharat', 'org_bharat', 'org_bharat']);

  const conflict = await writeCrmTask(connector, { ...CREATE_COMMAND, subject: 'Different action' }, 'org_bharat', clock);
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.code, 'idempotency-conflict');
});

test('CRM task adapter fails closed on an unversioned upstream response', async (t) => {
  const server = createServer(async (req, res) => {
    await readJson(req);
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ task: { id: 'task_0123456789abcdef' } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const result = await writeCrmTask(
    { id: 'crm', type: 'rest', endpoint: `http://127.0.0.1:${address.port}` },
    CREATE_COMMAND,
    'org_bharat',
  );
  assert.deepEqual(result, { ok: false, code: 'upstream-error', message: 'CRM task API returned an unsupported contract' });
});
