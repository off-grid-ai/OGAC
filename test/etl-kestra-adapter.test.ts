import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { normalizeExecutionStatus } from '../src/lib/adapters/kestra.ts';

// Tests for the orchestration adapter (Kestra behind OrchestrationPort). Two layers:
//  1. PURE — status normalization (no IO).
//  2. SHAPING — a fake global fetch stands in for the engine so we pin the request shapes (paths,
//     content-types, method) and the response normalization WITHOUT a live box, and prove graceful
//     degrade when the engine is unreachable (health=false, results carry an honest error).
// A single mock (fetch) is the only mock — everything else is the real adapter code.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.OFFGRID_KESTRA_URL;
  delete process.env.OFFGRID_KESTRA_TENANT;
  delete process.env.OFFGRID_KESTRA_USER;
  delete process.env.OFFGRID_KESTRA_PASSWORD;
});

// ── pure: status mapping ─────────────────────────────────────────────────────────────────────────
test('normalizeExecutionStatus maps engine states to the console vocabulary', () => {
  assert.equal(normalizeExecutionStatus('SUCCESS'), 'succeeded');
  assert.equal(normalizeExecutionStatus('RUNNING'), 'running');
  assert.equal(normalizeExecutionStatus('FAILED'), 'failed');
  assert.equal(normalizeExecutionStatus('KILLED'), 'failed');
  assert.equal(normalizeExecutionStatus('CANCELLED'), 'cancelled');
  assert.equal(normalizeExecutionStatus('CREATED'), 'pending');
  assert.equal(normalizeExecutionStatus('QUEUED'), 'pending');
  assert.equal(normalizeExecutionStatus(undefined), 'pending');
});

// Build a fake fetch that records requests and replies from a route table.
function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: { url: string; method: string; contentType?: string; body?: unknown }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method, contentType: headers['content-type'], body: init?.body });
    const { status, body } = handler(url, init ?? {});
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

// ── shaping: upsertFlow creates via POST /flows with x-yaml when the flow doesn't exist ───────────
test('upsertFlow POSTs new flow YAML with Content-Type application/x-yaml', async () => {
  process.env.OFFGRID_KESTRA_URL = 'http://kestra.test';
  const { kestraOrchestration } = await import('../src/lib/adapters/kestra.ts');
  const calls = fakeFetch((url) => {
    if (url.includes('/flows/offgrid.etl/etl_x')) return { status: 404, body: { message: 'not found' } };
    if (url.endsWith('/api/v1/main/flows')) return { status: 200, body: { id: 'etl_x', namespace: 'offgrid.etl', revision: 1 } };
    return { status: 404, body: {} };
  });
  const res = await kestraOrchestration.upsertFlow('id: etl_x\nnamespace: offgrid.etl\n', 'offgrid.etl', 'etl_x');
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.value.revision, 1);
  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post, 'a POST to create the flow happened');
  assert.equal(post!.url, 'http://kestra.test/api/v1/main/flows');
  assert.equal(post!.contentType, 'application/x-yaml');
});

test('upsertFlow PUTs to update an existing flow', async () => {
  process.env.OFFGRID_KESTRA_URL = 'http://kestra.test';
  const { kestraOrchestration } = await import('../src/lib/adapters/kestra.ts');
  const calls = fakeFetch((url, init) => {
    if (String(init.method).toUpperCase() === 'GET' && url.includes('/flows/offgrid.etl/etl_x'))
      return { status: 200, body: { id: 'etl_x', namespace: 'offgrid.etl', revision: 3 } };
    if (String(init.method).toUpperCase() === 'PUT')
      return { status: 200, body: { id: 'etl_x', namespace: 'offgrid.etl', revision: 4 } };
    return { status: 404, body: {} };
  });
  const res = await kestraOrchestration.upsertFlow('id: etl_x\n', 'offgrid.etl', 'etl_x');
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.value.revision, 4);
  const put = calls.find((c) => c.method === 'PUT');
  assert.ok(put, 'a PUT to update the flow happened');
  assert.equal(put!.url, 'http://kestra.test/api/v1/main/flows/offgrid.etl/etl_x');
  assert.equal(put!.contentType, 'application/x-yaml');
});

// ── shaping: execute POSTs to the executions endpoint and normalizes the response ────────────────
test('execute POSTs to /executions/{ns}/{id} and normalizes state → status', async () => {
  process.env.OFFGRID_KESTRA_URL = 'http://kestra.test';
  const { kestraOrchestration } = await import('../src/lib/adapters/kestra.ts');
  const calls = fakeFetch((url) => {
    if (url.includes('/executions/offgrid.etl/etl_x'))
      return {
        status: 200,
        body: { id: 'exec_1', flowId: 'etl_x', namespace: 'offgrid.etl', state: { current: 'CREATED' } },
      };
    return { status: 404, body: {} };
  });
  const res = await kestraOrchestration.execute('offgrid.etl', 'etl_x', { steps: '[]', job_id: 'etl_x' });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.executionId, 'exec_1');
    assert.equal(res.value.status, 'pending'); // CREATED → pending
  }
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post!.url, 'http://kestra.test/api/v1/main/executions/offgrid.etl/etl_x');
});

test('executionStatus + executionLogs normalize the engine payloads', async () => {
  process.env.OFFGRID_KESTRA_URL = 'http://kestra.test';
  const { kestraOrchestration } = await import('../src/lib/adapters/kestra.ts');
  fakeFetch((url) => {
    if (url.includes('/executions/exec_1'))
      return { status: 200, body: { id: 'exec_1', flowId: 'etl_x', namespace: 'offgrid.etl', state: { current: 'SUCCESS', duration: 1.2 } } };
    if (url.includes('/logs/exec_1'))
      return { status: 200, body: [{ timestamp: '2026-01-01T00:00:00Z', level: 'INFO', message: 'hello', taskId: 'run_pipeline' }] };
    return { status: 404, body: {} };
  });
  const status = await kestraOrchestration.executionStatus('exec_1');
  assert.equal(status?.status, 'succeeded');
  const logs = await kestraOrchestration.executionLogs('exec_1');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].message, 'hello');
  assert.equal(logs[0].level, 'INFO');
});

// ── honest degrade: unreachable engine → health false, results carry an error, never throws ──────
test('unreachable engine degrades gracefully (never throws, honest not-configured errors)', async () => {
  process.env.OFFGRID_KESTRA_URL = 'http://127.0.0.1:9'; // nothing listening
  const { kestraOrchestration } = await import('../src/lib/adapters/kestra.ts');
  assert.equal(await kestraOrchestration.health(), false);
  assert.deepEqual(await kestraOrchestration.listFlows(), []);
  assert.equal(await kestraOrchestration.getFlow('offgrid.etl', 'x'), null);
  const up = await kestraOrchestration.upsertFlow('id: x\n', 'offgrid.etl', 'x');
  assert.equal(up.ok, false);
  if (!up.ok) assert.ok(up.error.length > 0);
  const ex = await kestraOrchestration.execute('offgrid.etl', 'x');
  assert.equal(ex.ok, false);
  assert.equal(await kestraOrchestration.executionStatus('x'), null);
  assert.deepEqual(await kestraOrchestration.executionLogs('x'), []);
});

// ── auth: basic-auth header is set when user/pass are configured ─────────────────────────────────
test('basic auth header is attached when configured', async () => {
  process.env.OFFGRID_KESTRA_URL = 'http://kestra.test';
  process.env.OFFGRID_KESTRA_USER = 'admin@kestra.io';
  process.env.OFFGRID_KESTRA_PASSWORD = 'kestra';
  const { kestraOrchestration } = await import('../src/lib/adapters/kestra.ts');
  let authSeen: string | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    authSeen = h['authorization'];
    return new Response(JSON.stringify([]), { status: 200 });
  }) as typeof fetch;
  await kestraOrchestration.listFlows();
  assert.ok(authSeen?.startsWith('Basic '), 'Authorization: Basic header present');
  assert.equal(authSeen, `Basic ${Buffer.from('admin@kestra.io:kestra').toString('base64')}`);
});
