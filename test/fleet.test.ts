import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeModelConfig,
  derivePool,
  validateFleetNode,
  type FleetNode,
} from '../src/lib/fleet.ts';

const node = (over: Partial<FleetNode>): FleetNode => ({
  name: 'g1',
  host: 'offgrid-g1.local',
  port: 7878,
  role: 'gateway',
  kind: 'chat',
  model: 'qwythos-9b',
  primaryGguf: 'Qwythos-9B-Q4_K_M.gguf',
  mmprojGguf: 'mmproj-Qwythos-9B-f16.gguf',
  modelId: 'empero-ai/Qwythos-9B-GGUF',
  contextSize: null,
  vision: true,
  enabled: true,
  ...over,
});

// ── derivePool ────────────────────────────────────────────────────────────────

test('gateway nodes go to POOL, image nodes to IMAGE_POOL, servers excluded', () => {
  const { pool, imagePool } = derivePool([
    node({ name: 'g1', role: 'gateway', kind: 'chat', model: 'qwythos-9b' }),
    node({ name: 'g3', role: 'image', kind: 'image', model: 'juggernaut-xl-v9', port: 1234 }),
    node({ name: 's1', role: 'server', model: '' }),
    node({ name: 'g6', role: 'server', model: '' }),
  ]);
  assert.deepEqual(pool.map((p) => p.name), ['g1']);
  assert.deepEqual(imagePool.map((p) => p.name), ['g3']);
  assert.equal(imagePool[0].port, 1234);
});

test('a spare stays in POOL but disabled (out of rotation)', () => {
  const { pool } = derivePool([node({ name: 'g8', role: 'spare', enabled: false })]);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].enabled, false);
});

test('image kind is normalised to chat when it lands in POOL (defensive)', () => {
  // role gateway but kind image would be a misconfig; ensure POOL never carries kind:image
  const { pool, imagePool } = derivePool([node({ name: 'gx', role: 'gateway', kind: 'image' })]);
  assert.equal(pool.length, 0); // kind image → routed to imagePool
  assert.equal(imagePool.length, 1);
});

// ── activeModelConfig ───────────────────────────────────────────────────────────

test('activeModelConfig omits mmproj/ctx when unset, includes them when set', () => {
  assert.deepEqual(activeModelConfig({ modelId: 'x/y', primaryGguf: 'a.gguf', mmprojGguf: '', contextSize: null }), {
    id: 'x/y',
    primary: 'a.gguf',
  });
  assert.deepEqual(
    activeModelConfig({ modelId: 'x/y', primaryGguf: 'a.gguf', mmprojGguf: 'mm.gguf', contextSize: 32768 }),
    { id: 'x/y', primary: 'a.gguf', mmproj: 'mm.gguf', ctx: 32768 },
  );
});

// ── validateFleetNode ───────────────────────────────────────────────────────────

test('accepts a valid gateway node', () => {
  assert.deepEqual(validateFleetNode(node({})), { ok: true });
});

test('rejects bad name, port, role, and out-of-range context size', () => {
  assert.equal(validateFleetNode(node({ name: 'BAD NAME' })).ok, false);
  assert.equal(validateFleetNode(node({ port: 0 })).ok, false);
  assert.equal(validateFleetNode(node({ role: 'nope' as FleetNode['role'] })).ok, false);
  assert.equal(validateFleetNode(node({ contextSize: 10 })).ok, false);
  assert.equal(validateFleetNode(node({ contextSize: 32768 })).ok, true);
});

test('serving node requires model + primaryGguf; server does not', () => {
  assert.equal(validateFleetNode(node({ role: 'gateway', model: '' })).ok, false);
  assert.equal(validateFleetNode(node({ role: 'gateway', primaryGguf: '' })).ok, false);
  assert.equal(validateFleetNode(node({ name: 's1', role: 'server', model: '', primaryGguf: '' })).ok, true);
});
