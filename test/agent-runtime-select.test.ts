import assert from 'node:assert/strict';
import { test } from 'node:test';

// The agent-runtime selection seam. This exercises the REAL adapter module (no mocks): its static
// imports are pure (@/lib/agent-run-durable + a type-only AdapterMeta), and @temporalio/client is
// only reached via a dynamic import inside submit()/health() — so the module loads under node:test
// with no Temporal present. We assert the env-driven selection + the sync fallback contract.

async function load() {
  return await import('../src/lib/adapters/agentruntime.ts');
}

test('getAgentRuntime: defaults to sync when durable is not opted in', async () => {
  delete process.env.OFFGRID_QUEUE_ENABLED;
  delete process.env.OFFGRID_ADAPTER_AGENTRUNTIME;
  const { getAgentRuntime } = await load();
  assert.equal(getAgentRuntime().meta.id, 'sync');
});

test('getAgentRuntime: selects temporal when opted in', async () => {
  process.env.OFFGRID_ADAPTER_AGENTRUNTIME = 'temporal';
  const { getAgentRuntime } = await load();
  assert.equal(getAgentRuntime().meta.id, 'temporal');
  delete process.env.OFFGRID_ADAPTER_AGENTRUNTIME;
});

test('syncRuntime.submit: never claims durable — reports submitted:false so caller runs in-process', async () => {
  const { syncRuntime } = await load();
  const h = await syncRuntime.submit({ agentId: 'a', query: 'q', runId: 'run_1' });
  assert.equal(h.submitted, false);
  assert.equal(h.mode, 'sync');
  assert.equal(h.runId, 'run_1');
});

test('temporalRuntime.available: reflects the durable opt-in env', async () => {
  const { temporalRuntime } = await load();
  delete process.env.OFFGRID_QUEUE_ENABLED;
  delete process.env.OFFGRID_ADAPTER_AGENTRUNTIME;
  assert.equal(temporalRuntime.available(), false);
  process.env.OFFGRID_QUEUE_ENABLED = '1';
  assert.equal(temporalRuntime.available(), true);
  delete process.env.OFFGRID_QUEUE_ENABLED;
});
