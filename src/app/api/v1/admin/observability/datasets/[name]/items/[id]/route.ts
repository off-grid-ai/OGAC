import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { langfuseDatasets as port } from '@/lib/adapters/langfuse-datasets';
import { buildCreateItemBody, type CreateItemInput } from '@/lib/langfuse-datasets';
import { LangfuseHttpError } from '@/lib/langfuse-http';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Edit (PATCH = upsert by id) or delete ONE dataset item. Langfuse has no item-PATCH endpoint — an
// edit is a re-POST to /dataset-items with the same id, which the pure builder shapes.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ name: string; id: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name, id } = await params;
  if (!port.configured()) return NextResponse.json({ error: 'Langfuse not configured' }, { status: 503 });
  const body = (await req.json().catch(() => null)) as Omit<CreateItemInput, 'datasetName' | 'id'> | null;
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });
  const decoded = decodeURIComponent(name);
  const itemId = decodeURIComponent(id);
  const shaped = buildCreateItemBody({ ...body, datasetName: decoded, id: itemId });
  if (!shaped.ok) return NextResponse.json({ error: shaped.error }, { status: 400 });
  try {
    const item = await port.createItem(shaped.value);
    auditFromSession(gate, await currentOrgId(), {
      action: 'observability.dataset.item.update',
      resource: `dataset:${decoded}/item:${itemId}`,
      outcome: 'ok',
    });
    return NextResponse.json({ item });
  } catch (e) {
    const status = e instanceof LangfuseHttpError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ name: string; id: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name, id } = await params;
  if (!port.configured()) return NextResponse.json({ error: 'Langfuse not configured' }, { status: 503 });
  const decoded = decodeURIComponent(name);
  const itemId = decodeURIComponent(id);
  try {
    await port.removeItem(itemId);
    auditFromSession(gate, await currentOrgId(), {
      action: 'observability.dataset.item.delete',
      resource: `dataset:${decoded}/item:${itemId}`,
      outcome: 'ok',
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof LangfuseHttpError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
