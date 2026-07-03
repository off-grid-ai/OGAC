import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { getShowcase } from '@/lib/provit';

export const dynamic = 'force-dynamic';

// GET /api/v1/provit/showcase — thin handler: authenticate, then return Provit's showcase.
// getShowcase() never throws (returns { items, error }), so this route always responds 200.
export async function GET(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;

  const result = await getShowcase();
  return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
}
