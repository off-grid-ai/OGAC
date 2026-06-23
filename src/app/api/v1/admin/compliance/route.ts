import { NextResponse } from 'next/server';
import { computeCompliance } from '@/lib/compliance';

// Framework→control mapping with live coverage computed from the actual control-plane state.
export async function GET() {
  return NextResponse.json(await computeCompliance());
}
