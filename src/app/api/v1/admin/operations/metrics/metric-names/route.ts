import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { metricNames } from '@/lib/adapters/victoriametrics';

export const dynamic = 'force-dynamic';

// GET /api/v1/admin/operations/metrics/metric-names → the metric-name catalogue for the picker.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const result = await metricNames();
  return NextResponse.json(result);
}
