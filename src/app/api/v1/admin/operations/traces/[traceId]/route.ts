import { NextResponse } from 'next/server';
import { fetchTraceDetail } from '@/lib/adapters/jaeger';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// One trace's full span waterfall (for the detail view).
export async function GET(req: Request, { params }: { params: Promise<{ traceId: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { traceId } = await params;
  const id = (traceId ?? '').trim();
  if (!id) return NextResponse.json({ error: 'traceId is required' }, { status: 400 });
  return NextResponse.json(await fetchTraceDetail(id));
}
