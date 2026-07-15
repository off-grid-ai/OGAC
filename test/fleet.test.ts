import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeModelConfig,
  derivePool,
  deriveClusters,
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

// ── RPC cluster (distributed inference) ─────────────────────────────────────────

test('derivePool excludes RPC workers; only the cluster head is routed', () => {
  const { pool } = derivePool([
    node({ name: 'g7', port: 8439, model: 'qwythos-9b' }), // head — the routable endpoint
    node({ name: 'g2', clusterHead: 'g7', rpcPort: 50052, model: '' }), // worker — bonded, not routed
    node({ name: 'g4', clusterHead: 'g7', rpcPort: 50052, model: '' }), // worker
  ]);
  assert.deepEqual(
    pool.map((p) => p.name),
    ['g7'],
  );
  assert.equal(pool[0].port, 8439);
});

test('deriveClusters groups workers under their head; standalone nodes stay separate', () => {
  const { clusters, standalone } = deriveClusters([
    node({ name: 'g7', port: 8439 }),
    node({ name: 'g2', clusterHead: 'g7' }),
    node({ name: 'g4', clusterHead: 'g7' }),
    node({ name: 'g8' }), // standalone qwythos
    node({ name: 's1', role: 'server', model: '', primaryGguf: '' }),
  ]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].head.name, 'g7');
  assert.deepEqual(clusters[0].workers.map((w) => w.name).sort(), ['g2', 'g4']);
  assert.deepEqual(standalone.map((n) => n.name).sort(), ['g8', 's1']);
});

test('deriveClusters treats a dangling clusterHead as standalone (never drops a node)', () => {
  const { clusters, standalone } = deriveClusters([node({ name: 'g2', clusterHead: 'ghost' })]);
  assert.equal(clusters.length, 0);
  assert.deepEqual(standalone.map((n) => n.name), ['g2']);
});

test('an RPC worker is exempt from the model/primaryGguf requirement (the head owns those)', () => {
  assert.equal(validateFleetNode(node({ name: 'g2', clusterHead: 'g7', model: '', primaryGguf: '' })).ok, true);
});

test('validateFleetNode rejects a self-referential head, a bad clusterHead name, and a bad rpcPort', () => {
  assert.equal(validateFleetNode(node({ name: 'g7', clusterHead: 'g7' })).ok, false);
  assert.equal(validateFleetNode(node({ name: 'g2', clusterHead: 'Not Valid!' })).ok, false);
  assert.equal(validateFleetNode(node({ name: 'g2', clusterHead: 'g7', rpcPort: 0 })).ok, false);
  assert.equal(validateFleetNode(node({ name: 'g2', clusterHead: 'g7', rpcPort: 50052 })).ok, true);
});

test('deriveClusters is generic — groups a minimal {name, clusterHead} view model (DSP seam)', () => {
  const rows = [
    { name: 'g7', clusterHead: null },
    { name: 'g2', clusterHead: 'g7' },
    { name: 'x1', clusterHead: null },
  ];
  const { clusters, standalone } = deriveClusters(rows);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].head.name, 'g7');
  assert.deepEqual(clusters[0].workers.map((w) => w.name), ['g2']);
  assert.deepEqual(standalone.map((n) => n.name), ['x1']);
});
