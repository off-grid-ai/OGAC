import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteMonitor, updateMonitor } from '@/lib/opensearch-alerting';
import { normalizeMonitorSpec } from '@/lib/opensearch-alerting-shape';

export const dynamic = 'force-dynamic';

// Update/delete one alerting monitor by id (`_plugins/_alerting/monitors/<id>`).

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const spec = normalizeMonitorSpec(body ?? {});
  if (!spec) return NextResponse.json({ error: 'name and index are required' }, { status: 400 });
  const result = await updateMonitor(id, spec);
  if (result.error) return NextResponse.json(result, { status: 502 });
  return NextResponse.json(result);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const result = await deleteMonitor(id);
  if (result.error) return NextResponse.json(result, { status: 502 });
  if (!result.deleted && result.supported)
    return NextResponse.json(result, { status: 404 });
  return NextResponse.json(result);
}
