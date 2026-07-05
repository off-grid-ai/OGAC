import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/authz';
import { db } from '@/db';
import { fleetNodes } from '@/db/schema';
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';
import { activeModelConfig, validateFleetNode, type FleetNode } from '@/lib/fleet';

export const dynamic = 'force-dynamic';

// Edit ONE fleet node (the SSOT). This is the write path behind the node-config UI:
//   1. merge the patch onto the current row, validate (pure validateFleetNode),
//   2. persist to fleet_nodes (routing + status page follow on the aggregator's next refresh),
//   3. if the served model changed → PUSH to the node (aggregator activate: writes
//      active-model.json incl. context size + kickstarts, over SSH from S1),
//      if only `enabled` changed → tell the aggregator to re-adopt the pool.
// The console can't reach LAN nodes directly, so the push always goes via the aggregator.

const MODEL_KEYS = ['modelId', 'primaryGguf', 'mmprojGguf', 'contextSize'] as const;

async function tellAggregator(name: string, body: Record<string, unknown>) {
  try {
    const r = await fetch(`${GATEWAY_URL}/nodes/${encodeURIComponent(name)}`, {
      method: 'POST',
      cache: 'no-store',
      headers: gatewayHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ...j };
  } catch (e) {
    return { status: 502, error: (e as Error).message };
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { name } = await params;
  const patch = (await req.json().catch(() => null)) as Partial<FleetNode> | null;
  if (!patch || typeof patch !== 'object') {
    return NextResponse.json({ error: 'body must be a JSON object of fields to update' }, { status: 400 });
  }

  const [current] = await db.select().from(fleetNodes).where(eq(fleetNodes.name, name));
  if (!current) return NextResponse.json({ error: `node "${name}" not found` }, { status: 404 });

  // Merge only the editable fields, then validate the whole thing.
  const merged: FleetNode = {
    name: current.name,
    host: patch.host ?? current.host,
    port: patch.port ?? current.port,
    role: (patch.role ?? current.role) as FleetNode['role'],
    kind: (patch.kind ?? current.kind) as FleetNode['kind'],
    model: patch.model ?? current.model,
    primaryGguf: patch.primaryGguf ?? current.primaryGguf,
    mmprojGguf: patch.mmprojGguf ?? current.mmprojGguf,
    modelId: patch.modelId ?? current.modelId,
    contextSize: patch.contextSize === undefined ? current.contextSize : patch.contextSize,
    vision: patch.vision ?? current.vision,
    enabled: patch.enabled ?? current.enabled,
    notes: patch.notes ?? current.notes,
  };
  const check = validateFleetNode(merged);
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });

  await db
    .update(fleetNodes)
    .set({ ...merged, updatedAt: new Date() })
    .where(eq(fleetNodes.name, name));

  // Decide what to push to the node.
  const modelChanged = MODEL_KEYS.some((k) => patch[k] !== undefined && patch[k] !== current[k]);
  const enabledChanged = patch.enabled !== undefined && patch.enabled !== current.enabled;
  let push: Record<string, unknown> | null = null;
  if (modelChanged && merged.role !== 'server') {
    push = await tellAggregator(name, { action: 'activate', ...activeModelConfig(merged) });
  } else if (enabledChanged) {
    push = await tellAggregator(name, { action: merged.enabled ? 'enable' : 'disable' });
  } else {
    push = await tellAggregator(name, { action: merged.enabled ? 'enable' : 'disable' }); // nudge a refresh
  }

  return NextResponse.json({ ok: true, node: merged, push });
}
