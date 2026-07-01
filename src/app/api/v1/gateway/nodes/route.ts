import { NextResponse } from 'next/server';
import { clusterModels, type GatewayNode } from '@offgrid/gateway';

export const dynamic = 'force-dynamic';

// Gateway CONTROL plane — the per-node model view that powers load/unload/switch/pull/delete
// in the console. We discover the pool from the cluster gateway's own /health (gateways[]),
// then use @offgrid/gateway's clusterModels helpers to read each node's catalog/installed/active
// over its :7878 management API. Read-only here; mutations live in the [name] action route.
const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:8800';
const NODE_PORT = Number(process.env.OFFGRID_NODE_PORT ?? 7878);

interface PoolEntry {
  name: string;
  host: string;
  model: string;
  vision?: boolean;
  up?: boolean;
  health?: string;
}

// Resolve the node pool (name/host/model/health) from the cluster gateway.
export async function poolFromGateway(): Promise<PoolEntry[]> {
  const r = await fetch(`${GATEWAY_URL}/health`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
  if (!r.ok) return [];
  const info = await r.json();
  return Array.isArray(info?.gateways) ? (info.gateways as PoolEntry[]) : [];
}

export function toNode(p: PoolEntry): GatewayNode {
  return { name: p.name, host: p.host, port: NODE_PORT, model: p.model, vision: p.vision };
}

export async function GET() {
  try {
    const pool = await poolFromGateway();
    const nodes = await Promise.all(
      pool.map(async (p) => {
        const view = await clusterModels.nodeModels(toNode(p));
        return {
          name: p.name,
          host: p.host,
          model: p.model,
          vision: !!p.vision,
          health: p.health ?? (p.up ? 'up' : 'unknown'),
          reachable: view.reachable,
          active: view.active,
          installed: view.installed,
          catalogCount: Array.isArray(view.catalog) ? view.catalog.length : 0,
        };
      }),
    );
    return NextResponse.json({ available: true, nodes });
  } catch {
    return NextResponse.json({ available: false, nodes: [] }, { status: 200 });
  }
}
