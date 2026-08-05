import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { langfuseDatasets as port } from '@/lib/adapters/langfuse-datasets';
import { buildCreateDatasetBody, type CreateDatasetInput } from '@/lib/langfuse-datasets';
import { LangfuseHttpError } from '@/lib/langfuse-http';
import { filterByResolvedOrg } from '@/lib/langfuse-tenancy';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Langfuse-native datasets. GET lists (honest `configured` flag); POST creates a dataset.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  if (!port.configured()) return NextResponse.json({ configured: false, datasets: [] });
  try {
    // Narrowed to the caller's own tenant. The store is shared, so an unfiltered list returned every
    // tenant's datasets to every tenant — the same defect as the prompt registry beside it.
    const datasets = filterByResolvedOrg(await port.list(), await currentOrgId());
    return NextResponse.json({ configured: true, datasets });
  } catch (e) {
    const status = e instanceof LangfuseHttpError ? e.status : 502;
    return NextResponse.json({ configured: true, datasets: [], error: (e as Error).message }, { status });
  }
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  if (!port.configured()) return NextResponse.json({ error: 'Langfuse not configured' }, { status: 503 });
  const input = (await req.json().catch(() => null)) as CreateDatasetInput | null;
  if (!input) return NextResponse.json({ error: 'body required' }, { status: 400 });
  const shaped = buildCreateDatasetBody(input);
  if (!shaped.ok) return NextResponse.json({ error: shaped.error }, { status: 400 });
  const orgId = await currentOrgId();
  try {
    // STAMP OWNERSHIP AT CREATION, into metadata.org. Without it the dataset is unowned, and an unowned
    // record is shown to nobody — so the tenant that just created it could not see it.
    const dataset = await port.create({
      ...shaped.value,
      metadata: { ...(shaped.value.metadata as Record<string, unknown> | undefined), org: orgId },
    });
    auditFromSession(gate, orgId, {
      action: 'observability.dataset.create',
      resource: `dataset:${shaped.value.name}`,
      outcome: 'ok',
    });
    return NextResponse.json({ dataset }, { status: 201 });
  } catch (e) {
    const status = e instanceof LangfuseHttpError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
