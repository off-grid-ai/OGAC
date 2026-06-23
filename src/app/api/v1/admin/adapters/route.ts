import { NextResponse } from 'next/server';
import { listBindings } from '@/lib/adapters/registry';

// The capability→adapter bindings: which OSS tool currently serves each capability, what it
// can be swapped for, and how its UI is surfaced (native / embed / headless). `?health=1`
// probes the live inference backend.
export async function GET(req: Request) {
  const withHealth = new URL(req.url).searchParams.get('health') === '1';
  return NextResponse.json({ object: 'list', data: await listBindings(withHealth) });
}
