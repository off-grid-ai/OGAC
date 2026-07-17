import { NextResponse } from 'next/server';
import {
  gatewayControlFetch,
  mapAggregatorNode,
  nodeActionSupport,
  type AggregatorNode,
  type NodeAction,
} from '@/lib/gateway';

export const dynamic = 'force-dynamic';

// Gateway CONTROL plane — per-node inventory for the Node-control tab.
// The console PROXIES the cluster gateway's /nodes endpoint rather than reaching
// node :7878 APIs directly: the gateway runs where it can reach the LAN nodes,
// whereas the console (a macOS user LaunchAgent) is blocked from LAN peers by
// Local Network privacy. So the gateway fronts node inventory; we forward.
//
// The raw aggregator shape ({name,host,port,model,vision,health,installedModels})
// is normalised HERE (pure mapAggregatorNode) into the view the UI consumes, and
// we attach `support` — which write actions actually have a backend — so the UI
// can render unbacked actions as blocked (honest) instead of faking success.

const ACTIONS: NodeAction[] = ['model', 'restart', 'enable', 'disable'];

export async function GET() {
  try {
    const r = await gatewayControlFetch('/nodes', {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return NextResponse.json({ available: false, nodes: [], support: actionSupport() });
    const d = (await r.json()) as { nodes?: AggregatorNode[] };
    const nodes = (d.nodes ?? []).map(mapAggregatorNode);
    return NextResponse.json({ available: true, nodes, support: actionSupport() });
  } catch {
    return NextResponse.json({ available: false, nodes: [], support: actionSupport() });
  }
}

// Static capability map: for each action, whether a real backend exists and, if
// not, what's needed. Drives the UI's disabled-with-tooltip rendering.
function actionSupport(): Record<NodeAction, { backed: boolean; needs: string }> {
  return Object.fromEntries(ACTIONS.map((a) => [a, nodeActionSupport(a)])) as Record<
    NodeAction,
    { backed: boolean; needs: string }
  >;
}
