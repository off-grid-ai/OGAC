// Multinode model management — the control surface the console's management
// plane drives. Each node runs the single-node gateway (:7878) which already
// speaks the model-management API (catalog / installed / active / activate /
// pull / delete). Here we address a SPECIFIC node (management is never
// round-robined) and, where useful, aggregate across the pool.
//
// Settings (ctx size, KV-cache, flash-attn, GPU layers, threads, batch,
// sampling) go through /v1/settings — added to the node gateway in P3; these
// helpers degrade gracefully (return { supported:false }) when a node is older.
import type { GatewayNode } from './types';

const base = (g: GatewayNode): string => `http://${g.host}:${g.port}`;

async function getJson<T>(url: string, timeoutMs = 5000): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) } as RequestInit);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function send<T>(url: string, method: string, body?: unknown, timeoutMs = 10000): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const r = await fetch(url, {
      method,
      cache: 'no-store',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    } as RequestInit);
    let data: T | null = null;
    try {
      data = (await r.json()) as T;
    } catch {
      /* empty/non-json body */
    }
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export interface NodeModelView {
  node: string;
  catalog: unknown[];
  installed: string[];
  active: Record<string, string> | null;
  reachable: boolean;
}

/** The full model picture for one node: what's downloadable, installed, and active. */
export async function nodeModels(g: GatewayNode): Promise<NodeModelView> {
  const [catalog, installed, active] = await Promise.all([
    getJson<{ models?: unknown[] }>(`${base(g)}/v1/models/catalog`),
    getJson<{ installed?: string[] }>(`${base(g)}/v1/models/installed`),
    getJson<Record<string, string>>(`${base(g)}/v1/models/active`),
  ]);
  return {
    node: g.name,
    catalog: catalog?.models ?? [],
    installed: installed?.installed ?? [],
    active: active ?? null,
    reachable: catalog != null || installed != null || active != null,
  };
}

/** Load / switch the active model on a node (optionally scoped to a modality kind). */
export function activateModel(g: GatewayNode, id: string, kind?: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  return send(`${base(g)}/v1/models/activate`, 'POST', kind ? { id, kind } : { id });
}

/** Unload the active model on a node (kind defaults to text). Falls back to activating "" if unsupported. */
export async function unloadModel(g: GatewayNode, kind = 'text'): Promise<{ ok: boolean; status: number; data: unknown }> {
  const r = await send(`${base(g)}/v1/models/unload`, 'POST', { kind });
  if (r.status !== 404) return r;
  // Older nodes have no explicit unload; deactivate by activating an empty pick.
  return send(`${base(g)}/v1/models/activate`, 'POST', { id: '', kind });
}

/** Begin a download/pull of a catalog (or HF) model onto a node. */
export function pullModel(g: GatewayNode, id: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  return send(`${base(g)}/v1/models/pull`, 'POST', { id });
}

/** Poll a node's pull progress. */
export function pullStatus(g: GatewayNode, id: string): Promise<unknown> {
  return getJson(`${base(g)}/v1/models/pull/status?id=${encodeURIComponent(id)}`);
}

/** Delete an installed model from a node's disk. */
export function deleteModel(g: GatewayNode, id: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  return send(`${base(g)}/v1/models/${encodeURIComponent(id)}`, 'DELETE');
}

/** Read a node's runtime settings (ctx size, KV-cache, gpu layers, sampling, …). */
export async function getSettings(g: GatewayNode): Promise<{ supported: boolean; settings: Record<string, unknown> | null }> {
  const s = await getJson<Record<string, unknown>>(`${base(g)}/v1/settings`);
  return { supported: s != null, settings: s };
}

/** Update a node's runtime settings. Launch-time keys (ctx/kv/gpu/threads/batch)
 *  cause the node to respawn its model server; per-request keys apply live. */
export async function setSettings(
  g: GatewayNode,
  settings: Record<string, unknown>,
): Promise<{ supported: boolean; ok: boolean; status: number; data: unknown }> {
  const r = await send(`${base(g)}/v1/settings`, 'POST', settings);
  return { supported: r.status !== 404, ok: r.ok, status: r.status, data: r.data };
}
