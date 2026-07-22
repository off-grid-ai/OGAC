import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { langfuseDatasets as port } from '@/lib/adapters/langfuse-datasets';
import { buildCreateDatasetBody, type CreateDatasetInput } from '@/lib/langfuse-datasets';
import { LangfuseHttpError } from '@/lib/langfuse-http';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Langfuse-native datasets. GET lists (honest `configured` flag); POST creates a dataset.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  if (!port.configured()) return NextResponse.json({ configured: false, datasets: [] });
  try {
    return NextResponse.json({ configured: true, datasets: await port.list() });
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
  try {
    const dataset = await port.create(shaped.value);
    auditFromSession(gate, await currentOrgId(), {
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
