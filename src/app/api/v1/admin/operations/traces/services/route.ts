import { NextResponse } from 'next/server';
import { fetchTraceServices } from '@/lib/adapters/jaeger';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// Instrumented services for the trace-search service picker.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await fetchTraceServices());
}
