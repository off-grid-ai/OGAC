import { NextResponse } from 'next/server';
import { fetchTraceOperations } from '@/lib/adapters/jaeger';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// Operations for a given service — the trace-search operation picker.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const service = (new URL(req.url).searchParams.get('service') ?? '').trim();
  if (!service) return NextResponse.json({ error: 'service is required' }, { status: 400 });
  return NextResponse.json(await fetchTraceOperations(service));
}
