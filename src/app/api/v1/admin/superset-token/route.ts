import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { mintGuestToken } from '@/lib/superset';

// Mint a Superset guest token for the embedded-SDK dashboard flow. The browser exchanges this to
// render the dashboard iframe without Superset session cookies.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json(await mintGuestToken());
}
