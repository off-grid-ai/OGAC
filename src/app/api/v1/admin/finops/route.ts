import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { computeFinOps } from '@/lib/finops';

// Metering + cost + usage analytics, computed from the audit log priced per model.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await computeFinOps());
}
