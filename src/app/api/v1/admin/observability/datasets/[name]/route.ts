import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { langfuseDatasets as port } from '@/lib/adapters/langfuse-datasets';
import { LangfuseHttpError } from '@/lib/langfuse-http';
import { datasetBelongsToOrg } from '@/lib/langfuse-ownership';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// One dataset's detail: the dataset + its items + its experiment runs.
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name } = await params;
  if (!port.configured()) return NextResponse.json({ configured: false, detail: null });
  const decoded = decodeURIComponent(name);
  // 404 rather than 403: a 403 would confirm another tenant owns a dataset by this name, which is itself
  // a disclosure.
  if (!(await datasetBelongsToOrg(decoded, await currentOrgId()))) {
    return NextResponse.json({ configured: true, detail: null, error: 'not found' }, { status: 404 });
  }
  try {
    const detail = await port.detail(decoded);
    return NextResponse.json({ configured: true, detail });
  } catch (e) {
    const status = e instanceof LangfuseHttpError ? e.status : 502;
    return NextResponse.json({ configured: true, detail: null, error: (e as Error).message }, { status });
  }
}
