import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { test } from 'node:test';
import { writeCrmOpportunityFollowUp } from '@/lib/adapters/crm-writeback';
import { getSigning } from '@/lib/adapters/registry';
import {
  buildCrmOpportunityPatch,
  crmCommandHash,
  crmWritebackIdempotencyState,
  isCrmWritebackReplay,
  validateCrmOpportunityWriteback,
} from '@/lib/crm-writeback';

const VALID_COMMAND = {
  opportunityId: 1,
  idempotencyKey: 'cross-sell:account-1:v1',
  useCase: 'bank-cross-sell',
  followUp: {
    kind: 'call',
    summary: 'Discuss the approved next-best offer',
    dueAt: '2026-07-21T09:00:00.000Z',
    assignee: 'relationship-manager@example.test',
  },
  stage: 'proposal',
} as const;

test('CRM write-back validates the bounded command and rejects arbitrary fields/values', () => {
  const valid = validateCrmOpportunityWriteback(VALID_COMMAND);
  assert.equal(valid.ok, true);
  assert.equal(valid.value?.opportunityId, '1');

  const invalid = validateCrmOpportunityWriteback({
    ...VALID_COMMAND,
    opportunityId: '../admin',
    idempotencyKey: 'short',
    useCase: 'anything',
    followUp: { kind: 'delete', summary: '' },
    stage: 'drop_table',
  });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.errors, [
    'opportunityId must be a safe CRM record id',
    'idempotencyKey must be 8-128 letters, numbers, dot, colon, underscore, or dash',
    'useCase must be one of: bank-cross-sell, lender-delinquency',
    'followUp.kind must be one of: call, email, meeting, review',
    'followUp.summary must be 1-240 characters',
    'stage must be one of: discovery, qualification, proposal, negotiation, closed_won, closed_lost',
  ]);
});

test('CRM patch derives tenant metadata server-side and replay requires matching tenant and key', () => {
  const input = validateCrmOpportunityWriteback(VALID_COMMAND).value!;
  const patch = buildCrmOpportunityPatch(input, {
    orgId: 'bank-tenant',
    writtenAt: '2026-07-20T12:00:00.000Z',
  });
  assert.deepEqual(patch.offgrid_writeback, {
    idempotency_key: VALID_COMMAND.idempotencyKey,
    command_hash: crmCommandHash(input),
    source_use_case: 'bank-cross-sell',
    org_id: 'bank-tenant',
    written_at: '2026-07-20T12:00:00.000Z',
  });
  assert.equal(isCrmWritebackReplay(patch, 'bank-tenant', VALID_COMMAND.idempotencyKey), true);
  assert.equal(isCrmWritebackReplay(patch, 'other-tenant', VALID_COMMAND.idempotencyKey), false);
  assert.equal(
    crmWritebackIdempotencyState(patch, 'bank-tenant', VALID_COMMAND.idempotencyKey, crmCommandHash(input)),
    'replay',
  );
  assert.equal(
    crmWritebackIdempotencyState(patch, 'bank-tenant', VALID_COMMAND.idempotencyKey, 'different'),
    'conflict',
  );
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

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

test('CRM adapter performs one real HTTP PATCH, replays idempotently, and signs receipts', async (t) => {
  let record: Record<string, unknown> = {
    id: 1,
    account_id: 1,
    name: 'Claims automation expansion',
    stage: 'negotiation',
  };
  let patches = 0;
  const server = createServer(async (req, res) => {
    if (req.url !== '/opportunities/1') return json(res, 404, { error: 'not found' });
    if (req.method === 'GET') return json(res, 200, record);
    if (req.method === 'PATCH') {
      patches += 1;
      record = { ...record, ...(await readJson(req)) };
      return json(res, 200, record);
    }
    return json(res, 405, { error: 'method' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const connector = {
    id: 'con_crm',
    type: 'rest',
    endpoint: `http://127.0.0.1:${address.port}`,
  };
  const clock = () => new Date('2026-07-20T12:00:00.000Z');

  const first = await writeCrmOpportunityFollowUp(connector, VALID_COMMAND, 'bank-tenant', clock);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.receipt.replayed, false);
  assert.equal(first.record.stage, 'proposal');
  assert.equal(patches, 1);
  const signing = getSigning();
  const { signature, algorithm: _algorithm, publicKey: _publicKey, ...signed } = first.receipt;
  assert.equal(signing.verify(signed, signature), true, 'receipt is verifiable by the active signing port');

  const replay = await writeCrmOpportunityFollowUp(connector, VALID_COMMAND, 'bank-tenant', clock);
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.receipt.replayed, true);
  assert.equal(patches, 1, 'same tenant + idempotency key does not write twice');

  const conflict = await writeCrmOpportunityFollowUp(
    connector,
    { ...VALID_COMMAND, followUp: { ...VALID_COMMAND.followUp, summary: 'A different action' } },
    'bank-tenant',
    clock,
  );
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.code, 'idempotency-conflict');
  assert.equal(patches, 1, 'reusing a key for a different command is rejected');
});

test('CRM adapter reports invalid, missing, and unsupported requests without fabrication', async () => {
  const invalid = await writeCrmOpportunityFollowUp(
    { id: 'con_crm', type: 'rest', endpoint: 'http://127.0.0.1:1' },
    {},
    'org',
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, 'invalid-command');

  const unsupported = await writeCrmOpportunityFollowUp(
    { id: 'con_db', type: 'postgres', endpoint: 'postgres://localhost/db' },
    VALID_COMMAND,
    'org',
  );
  assert.deepEqual(unsupported, {
    ok: false,
    code: 'unsupported-connector',
    message: 'connector is not a reachable REST source',
  });

  const malformed = await writeCrmOpportunityFollowUp(
    { id: 'con_bad', type: 'rest', endpoint: 'not a url' },
    VALID_COMMAND,
    'org',
  );
  assert.equal(malformed.ok, false);
});
