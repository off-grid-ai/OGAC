import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { langfuseDatasets as port } from '@/lib/adapters/langfuse-datasets';
import { buildCreateItemBody, type CreateItemInput } from '@/lib/langfuse-datasets';
import { LangfuseHttpError } from '@/lib/langfuse-http';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Add an item to a dataset. Langfuse upserts items by id, so an id in the body edits an existing item;
// no id creates a new one. `datasetName` comes from the path — the body carries input/expectedOutput/
// metadata/status.
export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name } = await params;
  if (!port.configured()) return NextResponse.json({ error: 'Langfuse not configured' }, { status: 503 });
  const body = (await req.json().catch(() => null)) as Omit<CreateItemInput, 'datasetName'> | null;
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });
  const decoded = decodeURIComponent(name);
  const shaped = buildCreateItemBody({ ...body, datasetName: decoded });
  if (!shaped.ok) return NextResponse.json({ error: shaped.error }, { status: 400 });
  try {
    const item = await port.createItem(shaped.value);
    auditFromSession(gate, await currentOrgId(), {
      action: shaped.value.id ? 'observability.dataset.item.update' : 'observability.dataset.item.create',
      resource: `dataset:${decoded}/item:${item?.id ?? shaped.value.id ?? 'new'}`,
      outcome: 'ok',
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (e) {
    const status = e instanceof LangfuseHttpError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
