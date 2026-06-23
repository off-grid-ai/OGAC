import { NextResponse } from 'next/server';
import { listIngestJobs } from '@/lib/store';

export async function GET() {
  return NextResponse.json({ object: 'list', data: await listIngestJobs() });
}
