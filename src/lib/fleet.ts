// Fleet topology — PURE derivation rules (zero-import, unit-testable). No I/O.
//
// `fleet_nodes` (DB) is the single source of truth. Everything downstream is
// DERIVED here so there is exactly one place that decides "what does the fleet
// look like": the aggregator's routing POOL/IMAGE_POOL (scripts/gateway-aggregator.mjs
// fetches these via the console), and each node's active-model.json (what the
// console pushes to a node over SSH). Keep this file free of fetch/db/fs so it
// stays trivially testable — the route handlers and the aggregator do the I/O.

export type NodeRole = 'gateway' | 'server' | 'image' | 'spare';
export type NodeKind = 'chat' | 'grounding' | 'image';

export interface FleetNode {
  name: string;
  host: string;
  port: number;
  role: NodeRole;
  kind: NodeKind;
  model: string;
  primaryGguf: string;
  mmprojGguf: string;
  modelId: string;
  contextSize: number | null;
  vision: boolean;
  enabled: boolean;
  notes?: string;
  // Distributed inference (llama.cpp RPC over Thunderbolt). A node is an RPC WORKER when
  // `clusterHead` names another node: its GPU is bonded into that head's serving process and
  // it is NOT independently routable. The HEAD is a normal serving node (its `port` is the
  // cluster's OpenAI-compatible port, e.g. 8439) that other nodes reference. `rpcPort` is the
  // worker's ggml-rpc-server port (default 50052). Both null/absent ⇒ an ordinary standalone node.
  clusterHead?: string | null;
  rpcPort?: number | null;
}

/** A routing-pool entry in the shape the aggregator's `POOL` expects. */
export interface PoolEntry {
  name: string;
  host: string;
  port: number;
  vision: boolean;
  kind: NodeKind;
  model: string;
  enabled?: boolean;
}

/** An image-pool entry in the shape the aggregator's `IMAGE_POOL` expects. */
export interface ImagePoolEntry {
  name: string;
  host: string;
  port: number;
  model: string;
  enabled?: boolean;
}

const ROLES: ReadonlySet<NodeRole> = new Set(['gateway', 'server', 'image', 'spare']);
const KINDS: ReadonlySet<NodeKind> = new Set(['chat', 'grounding', 'image']);

/**
 * Derive the aggregator's chat/grounding POOL and IMAGE_POOL from fleet rows.
 * - `server` nodes run infra (no LLM) → excluded from both pools.
 * - `image` nodes (or kind==='image') → IMAGE_POOL.
 * - everything else (gateway / spare) → POOL, carrying its `enabled` flag so a
 *   spare or a drained node stays listed but out of rotation.
 */
export function derivePool(nodes: FleetNode[]): { pool: PoolEntry[]; imagePool: ImagePoolEntry[] } {
  const pool: PoolEntry[] = [];
  const imagePool: ImagePoolEntry[] = [];
  for (const n of nodes) {
    if (n.role === 'server') continue;
    // RPC worker: its GPU is bonded into a cluster head's process; the head is the only
    // routable endpoint, so a worker never appears in the pool on its own.
    if (n.clusterHead) continue;
    if (n.role === 'image' || n.kind === 'image') {
      imagePool.push({ name: n.name, host: n.host, port: n.port, model: n.model, enabled: n.enabled });
      continue;
    }
    pool.push({
      name: n.name,
      host: n.host,
      port: n.port,
      vision: n.vision,
      kind: n.kind, // image nodes already continue'd above → n.kind is 'chat' | 'grounding' here
      model: n.model,
      enabled: n.enabled,
    });
  }
  return { pool, imagePool };
}

/** A distributed RPC cluster: one serving HEAD backed by bonded WORKER nodes. */
export interface FleetCluster {
  head: FleetNode;
  workers: FleetNode[];
}

/**
 * Group RPC-cluster members under their head (pure; for the UI + status views).
 * A node is a HEAD iff some other node names it via `clusterHead`; its WORKERS are those
 * referencing it. Everything that is neither a head nor a worker is `standalone`. A worker
 * whose `clusterHead` points at a missing node is treated as standalone (defensive — a
 * dangling reference must not vanish from the UI).
 */
export function deriveClusters(nodes: FleetNode[]): { clusters: FleetCluster[]; standalone: FleetNode[] } {
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const workersByHead = new Map<string, FleetNode[]>();
  for (const n of nodes) {
    if (n.clusterHead && byName.has(n.clusterHead)) {
      (workersByHead.get(n.clusterHead) ?? workersByHead.set(n.clusterHead, []).get(n.clusterHead)!).push(n);
    }
  }
  const clusters: FleetCluster[] = [];
  const standalone: FleetNode[] = [];
  for (const n of nodes) {
    if (n.clusterHead && byName.has(n.clusterHead)) continue; // a bonded worker — rendered under its head
    const workers = workersByHead.get(n.name);
    if (workers && workers.length) clusters.push({ head: n, workers });
    else standalone.push(n);
  }
  return { clusters, standalone };
}

/** The active-model.json a node's gateway reads. Omits empty optional fields. */
export function activeModelConfig(n: Pick<FleetNode, 'modelId' | 'primaryGguf' | 'mmprojGguf' | 'contextSize'>): Record<string, unknown> {
  const cfg: Record<string, unknown> = { id: n.modelId, primary: n.primaryGguf };
  if (n.mmprojGguf) cfg.mmproj = n.mmprojGguf;
  if (typeof n.contextSize === 'number' && n.contextSize > 0) cfg.ctx = n.contextSize;
  return cfg;
}

export type FleetValidation = { ok: true } | { ok: false; reason: string };

/** Validate a fleet-node config before it's written to the SSOT. Pure. */
export function validateFleetNode(n: Partial<FleetNode>): FleetValidation {
  const name = (n.name ?? '').trim();
  if (!/^[a-z0-9-]{1,32}$/.test(name)) return { ok: false, reason: 'name must be 1–32 chars of [a-z0-9-]' };
  if (!(n.host ?? '').trim()) return { ok: false, reason: 'host is required' };
  if (!Number.isInteger(n.port) || (n.port as number) < 1 || (n.port as number) > 65535)
    return { ok: false, reason: 'port must be 1–65535' };
  if (!n.role || !ROLES.has(n.role)) return { ok: false, reason: `role must be one of ${[...ROLES].join('|')}` };
  if (!n.kind || !KINDS.has(n.kind)) return { ok: false, reason: `kind must be one of ${[...KINDS].join('|')}` };
  // An RPC worker is bonded into a head's process — it has no routing tag or model file of
  // its own (the head owns those), so it's exempt from the serving-node requirements below.
  const isWorker = !!(n.clusterHead ?? '').trim();
  if (isWorker) {
    if (!/^[a-z0-9-]{1,32}$/.test(n.clusterHead as string))
      return { ok: false, reason: 'clusterHead must be a valid node name ([a-z0-9-], 1–32)' };
    if (n.clusterHead === name) return { ok: false, reason: 'a node cannot be its own cluster head' };
  }
  // Serving nodes need a routing tag + a model file; servers and RPC workers don't.
  if (n.role !== 'server' && !isWorker) {
    if (!(n.model ?? '').trim()) return { ok: false, reason: 'model (routing tag) is required for a serving node' };
    if (!(n.primaryGguf ?? '').trim()) return { ok: false, reason: 'primaryGguf is required for a serving node' };
  }
  if (n.rpcPort != null) {
    if (!Number.isInteger(n.rpcPort) || n.rpcPort < 1 || n.rpcPort > 65535)
      return { ok: false, reason: 'rpcPort must be 1–65535' };
  }
  if (n.contextSize != null) {
    if (!Number.isInteger(n.contextSize) || n.contextSize < 512 || n.contextSize > 1_000_000)
      return { ok: false, reason: 'contextSize must be an integer 512–1000000, or empty for node default' };
  }
  return { ok: true };
}
