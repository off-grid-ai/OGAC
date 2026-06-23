import { NextResponse } from 'next/server';
import { listEvalRuns } from '@/lib/evals';

export async function GET() {
  return NextResponse.json({ object: 'list', data: await listEvalRuns() });
}
