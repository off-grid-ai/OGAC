import { NextResponse, type NextRequest } from 'next/server';
import { clusterModels } from '@offgrid/gateway';
import { poolFromGateway, toNode } from '../route';

export const dynamic = 'force-dynamic';

// Gateway control ACTIONS on one node: load/switch (activate), unload, pull, delete, settings.
// POST { action, id?, kind?, settings? } — resolves the node from the pool, then dispatches to
// the matching @offgrid/gateway clusterModels helper (which speaks the node's :7878 mgmt API).
// eslint-disable-next-line complexity
export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    id?: string;
    kind?: string;
    settings?: Record<string, unknown>;
  };
  const pool = await poolFromGateway();
  const entry = pool.find((p) => p.name === name);
  if (!entry) return NextResponse.json({ error: `unknown node ${name}` }, { status: 404 });
  const node = toNode(entry);

  try {
    switch (body.action) {
      case 'activate':
        if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
        return NextResponse.json(await clusterModels.activateModel(node, body.id, body.kind));
      case 'unload':
        return NextResponse.json(await clusterModels.unloadModel(node, body.kind ?? 'text'));
      case 'pull':
        if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
        return NextResponse.json(await clusterModels.pullModel(node, body.id));
      case 'delete':
        if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
        return NextResponse.json(await clusterModels.deleteModel(node, body.id));
      case 'settings':
        if (body.settings) return NextResponse.json(await clusterModels.setSettings(node, body.settings));
        return NextResponse.json(await clusterModels.getSettings(node));
      default:
        return NextResponse.json({ error: `unknown action ${body.action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
