import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { computeCompliance } from '@/lib/compliance';

// Framework→control mapping with live coverage computed from the actual control-plane state.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await computeCompliance());
}
