import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import {
  GATEWAY_URL,
  gatewayHeaders,
  mapAggregatorNode,
  validateNodeAction,
  type AggregatorNode,
  type NodeAction,
  type NodeActionRequest,
} from '@/lib/gateway';

export const dynamic = 'force-dynamic';

// Per-node control actions — model swap, restart, enable/disable in the pool.
// Thin: admin-gated, validated by the pure `validateNodeAction`, then forwarded
// to the cluster gateway (the console can't reach LAN nodes directly under macOS
// Local Network privacy).
//
// The aggregator fronts real control at POST /nodes/:name (SSH-to-node from S1):
// activate = write active-model.json + kickstart; restart; enable/disable = adopt
// the SSOT pool (see src/lib/gateway.ts CONTROL CONTRACT + SERVER_STATE.md).
// HONESTY: we still forward the truth of the wire — if the aggregator replies
// 404/501 (older/absent endpoint) we answer 501 { notActionable }, never a fake 200.

const VALID_ACTIONS = new Set<NodeAction>(['model', 'restart', 'enable', 'disable']);

async function fetchNode(name: string): Promise<AggregatorNode | null> {
  try {
    const r = await fetch(`${GATEWAY_URL}/nodes`, {
      cache: 'no-store',
      headers: gatewayHeaders(),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { nodes?: AggregatorNode[] };
    return (d.nodes ?? []).find((n) => n.name === name) ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { name } = await params;
  const parsed = (await req.json().catch(() => null)) as NodeActionRequest | null;
  if (!parsed || !VALID_ACTIONS.has(parsed.action)) {
    return NextResponse.json({ error: 'action must be one of model|restart|enable|disable' }, { status: 400 });
  }

  const raw = await fetchNode(name);
  if (!raw) return NextResponse.json({ error: `node "${name}" not found in the pool` }, { status: 404 });

  const decision = validateNodeAction(mapAggregatorNode(raw), parsed);
  if (!decision.ok) {
    // Blocked = no real backend for this action; 501 keeps us honest (no fake 200).
    const status = decision.blocked ? 501 : 400;
    return NextResponse.json({ error: decision.reason, notActionable: Boolean(decision.blocked) }, { status });
  }

  // Backed action → forward to the aggregator's control endpoint. If the gateway
  // doesn't actually implement it (404/501), surface not-actionable, don't lie.
  try {
    const r = await fetch(`${GATEWAY_URL}/nodes/${encodeURIComponent(name)}`, {
      method: 'POST',
      cache: 'no-store',
      headers: gatewayHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(decision.body),
      signal: AbortSignal.timeout(120000),
    });
    if (r.status === 404 || r.status === 501) {
      return NextResponse.json(
        { error: 'the cluster gateway does not expose this control action', notActionable: true },
        { status: 501 },
      );
    }
    return NextResponse.json(await r.json().catch(() => ({ ok: r.ok })), { status: r.status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
