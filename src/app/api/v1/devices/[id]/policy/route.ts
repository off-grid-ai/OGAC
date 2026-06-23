import { NextResponse } from 'next/server';
import { pullPolicyForDevice } from '@/lib/store';

// Node pulls its current policy bundle (and reports in, converging to the org version).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const policy = await pullPolicyForDevice(id);
  if (!policy) {
    return NextResponse.json({ error: 'unknown device' }, { status: 404 });
  }
  return NextResponse.json(policy);
}
