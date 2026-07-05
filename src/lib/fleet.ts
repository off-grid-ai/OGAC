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
  // Serving nodes need a routing tag + a model file; servers don't.
  if (n.role !== 'server') {
    if (!(n.model ?? '').trim()) return { ok: false, reason: 'model (routing tag) is required for a serving node' };
    if (!(n.primaryGguf ?? '').trim()) return { ok: false, reason: 'primaryGguf is required for a serving node' };
  }
  if (n.contextSize != null) {
    if (!Number.isInteger(n.contextSize) || n.contextSize < 512 || n.contextSize > 1_000_000)
      return { ok: false, reason: 'contextSize must be an integer 512–1000000, or empty for node default' };
  }
  return { ok: true };
}
