import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for the distributed RPC-cluster feature (added 2026-07-15): the fleet_nodes
// `cluster_head` + `rpc_port` columns must PERSIST to a real Postgres, and the pure derivation
// (derivePool / deriveClusters, src/lib/fleet.ts) must produce the right routing + grouping when
// run over rows read back from the DB. This proves the whole seam end-to-end — schema → DB write →
// read → derivation — not just that the pure functions work on hand-built objects.
//
// The fleet_nodes primary key is `name` (NOT org-scoped), so this uses a dedicated `tint-` name
// prefix that can never collide with the real g1..g8 / s1 rows, and deletes every row it wrote.
// Skips green if no Postgres is reachable (DB-less CI).

const PFX = 'tint-';
const dbUp = await dbReachable();

test('RPC cluster: cluster_head/rpc_port persist + derivePool/deriveClusters round-trip', {
  skip: dbUp ? false : SKIP_MESSAGE,
}, async (t) => {
  const { db } = await import('@/db');
  const { fleetNodes } = await import('@/db/schema');
  const { derivePool, deriveClusters } = await import('@/lib/fleet');
  const { eq, like, sql } = await import('drizzle-orm');

  // Self-provision the table (mirrors src/db/schema.ts) so the suite runs for real on any reachable
  // Postgres, not only one that has been `db:push`'d — same convention as the other integration
  // suites (CREATE TABLE IF NOT EXISTS). The two ADD COLUMN IF NOT EXISTS upgrade an older-schema
  // table so the cluster columns under test are always present.
  await db.execute(sql`CREATE TABLE IF NOT EXISTS fleet_nodes (
    name text PRIMARY KEY, host text NOT NULL, port integer NOT NULL DEFAULT 7878,
    role text NOT NULL DEFAULT 'gateway', kind text NOT NULL DEFAULT 'chat',
    model text NOT NULL DEFAULT '', primary_gguf text NOT NULL DEFAULT '',
    mmproj_gguf text NOT NULL DEFAULT '', model_id text NOT NULL DEFAULT '',
    context_size integer, vision boolean NOT NULL DEFAULT true, enabled boolean NOT NULL DEFAULT true,
    notes text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.execute(sql`ALTER TABLE fleet_nodes ADD COLUMN IF NOT EXISTS cluster_head text`);
  await db.execute(sql`ALTER TABLE fleet_nodes ADD COLUMN IF NOT EXISTS rpc_port integer`);

  const cleanup = async () => {
    await db.delete(fleetNodes).where(like(fleetNodes.name, `${PFX}%`));
  };
  await cleanup(); // clear any leftovers from a prior aborted run
  t.after(cleanup);

  // ── WRITE a cluster: one head (routable serving endpoint) + two bonded RPC workers ────────────
  const head = `${PFX}g7`;
  const w1 = `${PFX}g2`;
  const w2 = `${PFX}g4`;
  await db.insert(fleetNodes).values([
    { name: head, host: 'tint-g7.local', port: 8439, role: 'gateway', kind: 'chat', model: 'qwythos-9b-1m', vision: true, enabled: true },
    { name: w1, host: 'tint-g2.local', port: 7878, role: 'gateway', kind: 'chat', model: '', vision: true, enabled: false, clusterHead: head, rpcPort: 50052 },
    { name: w2, host: 'tint-g4.local', port: 7878, role: 'gateway', kind: 'chat', model: '', vision: true, enabled: false, clusterHead: head, rpcPort: 50052 },
  ]);

  // ── READ back: the new columns must have persisted ────────────────────────────────────────────
  const [w1row] = await db.select().from(fleetNodes).where(eq(fleetNodes.name, w1));
  assert.equal(w1row.clusterHead, head, 'cluster_head persisted');
  assert.equal(w1row.rpcPort, 50052, 'rpc_port persisted');
  const [headRow] = await db.select().from(fleetNodes).where(eq(fleetNodes.name, head));
  assert.equal(headRow.clusterHead, null, 'a head has no cluster_head');
  assert.equal(headRow.port, 8439, 'head serves on the cluster port');

  // ── DERIVE over the real rows (only our tint- rows) ───────────────────────────────────────────
  const rows = (await db.select().from(fleetNodes).where(like(fleetNodes.name, `${PFX}%`))).map((r) => ({
    name: r.name, host: r.host, port: r.port,
    role: r.role as 'gateway', kind: r.kind as 'chat',
    model: r.model, primaryGguf: r.primaryGguf, mmprojGguf: r.mmprojGguf, modelId: r.modelId,
    contextSize: r.contextSize, vision: r.vision, enabled: r.enabled,
    clusterHead: r.clusterHead, rpcPort: r.rpcPort,
  }));

  const { pool } = derivePool(rows);
  assert.deepEqual(pool.map((p) => p.name), [head], 'only the head is routed; workers are bonded, not routed');
  assert.equal(pool[0].port, 8439);

  const { clusters, standalone } = deriveClusters(rows);
  assert.equal(clusters.length, 1, 'one cluster');
  assert.equal(clusters[0].head.name, head);
  assert.deepEqual(clusters[0].workers.map((w) => w.name).sort(), [w1, w2].sort());
  assert.equal(standalone.length, 0, 'all three rows are cluster members');

  // ── UPDATE: dissolve the cluster (clear a worker's clusterHead) → it becomes standalone ────────
  await db.update(fleetNodes).set({ clusterHead: null, model: 'gemma-4-e4b' }).where(eq(fleetNodes.name, w1));
  const rows2 = (await db.select().from(fleetNodes).where(like(fleetNodes.name, `${PFX}%`))).map((r) => ({
    name: r.name, host: r.host, port: r.port,
    role: r.role as 'gateway', kind: r.kind as 'chat',
    model: r.model, primaryGguf: r.primaryGguf, mmprojGguf: r.mmprojGguf, modelId: r.modelId,
    contextSize: r.contextSize, vision: r.vision, enabled: r.enabled,
    clusterHead: r.clusterHead, rpcPort: r.rpcPort,
  }));
  const after = deriveClusters(rows2);
  assert.deepEqual(after.clusters[0].workers.map((w) => w.name), [w2], 'the freed worker left the cluster');
  assert.deepEqual(after.standalone.map((n) => n.name), [w1], 'the freed worker is now standalone');
});
