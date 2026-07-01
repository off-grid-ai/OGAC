import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { listFlags, setFlag } from '@/lib/store';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listFlags() });
}

export async function PATCH(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as { key?: unknown; enabled?: unknown } | null;
  if (!b || typeof b.key !== 'string' || typeof b.enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'key (string) + enabled (boolean) required' },
      { status: 400 },
    );
  }
  await setFlag(b.key, b.enabled);
  return NextResponse.json({ ok: true });
}
