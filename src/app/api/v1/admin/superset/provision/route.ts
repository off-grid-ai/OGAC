import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { provisionDashboard } from '@/lib/superset';

export const dynamic = 'force-dynamic';

// Idempotently provision the Off Grid AI starter dashboard in Superset (database → dataset → charts →
// dashboard). Reuses an existing one rather than duplicating. Returns the embeddable UUID.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const result = await provisionDashboard();
  return NextResponse.json(result, { status: result.ok || !result.configured ? 200 : 502 });
}
