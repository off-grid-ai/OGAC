import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { langfuseDatasets as port } from '@/lib/adapters/langfuse-datasets';
import { LangfuseHttpError } from '@/lib/langfuse-http';

export const dynamic = 'force-dynamic';

// One dataset's detail: the dataset + its items + its experiment runs.
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { name } = await params;
  if (!port.configured()) return NextResponse.json({ configured: false, detail: null });
  try {
    const detail = await port.detail(decodeURIComponent(name));
    return NextResponse.json({ configured: true, detail });
  } catch (e) {
    const status = e instanceof LangfuseHttpError ? e.status : 502;
    return NextResponse.json({ configured: true, detail: null, error: (e as Error).message }, { status });
  }
}
