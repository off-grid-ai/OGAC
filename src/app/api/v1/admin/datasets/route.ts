import { NextResponse } from 'next/server';
import { listDatasets } from '@/lib/store';

export async function GET() {
  return NextResponse.json({ object: 'list', data: await listDatasets() });
}
