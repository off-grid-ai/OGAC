import { NextResponse } from 'next/server';
import { listDevices } from '@/lib/store';

// Headless fleet API — the "just the API" contract; the Fleet UI is one consumer of it.
export async function GET() {
  return NextResponse.json({ object: 'list', data: await listDevices() });
}
