import { NextResponse } from 'next/server';
import { computeAnalytics } from '@/lib/analytics';
import { requireAdmin } from '@/lib/authz';

// Observability over the audit/telemetry stream — usage, latency, drift, perf degradation.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await computeAnalytics());
}
