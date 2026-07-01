import { NextResponse } from 'next/server';
import { mintGuestToken } from '@/lib/superset';

// Mint a Superset guest token for the embedded-SDK dashboard flow. The browser exchanges this to
// render the dashboard iframe without Superset session cookies.
export async function POST() {
  return NextResponse.json(await mintGuestToken());
}
