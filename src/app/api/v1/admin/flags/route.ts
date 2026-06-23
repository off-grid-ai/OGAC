import { NextResponse } from 'next/server';
import { listFlags, setFlag } from '@/lib/store';

export async function GET() {
  return NextResponse.json({ object: 'list', data: await listFlags() });
}

export async function PATCH(req: Request) {
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
