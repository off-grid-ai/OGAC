import { NextResponse } from 'next/server';
import { listBindings } from '@/lib/adapters/registry';
import { requireAdmin } from '@/lib/authz';

// The capability→adapter bindings: which OSS tool currently serves each capability, what it
// can be swapped for, and how its UI is surfaced (native / embed / headless). `?health=1`
// probes the live inference backend.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const withHealth = new URL(req.url).searchParams.get('health') === '1';
  return NextResponse.json({ object: 'list', data: await listBindings(withHealth) });
}
