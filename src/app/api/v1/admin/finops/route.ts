import { NextResponse } from 'next/server';
import { computeFinOps } from '@/lib/finops';

// Metering + cost + usage analytics, computed from the audit log priced per model.
export async function GET() {
  return NextResponse.json(await computeFinOps());
}
