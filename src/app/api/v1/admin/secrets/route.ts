import { NextResponse } from 'next/server';
import { openBaoConfigured, openBaoSecrets } from '@/lib/adapters/secrets';
import { requireAdmin } from '@/lib/authz';

// OpenBao secrets management. Stores connector/tool credentials and virtual-key secrets in
// OpenBao KV v2 via the openBaoSecrets adapter. Secret VALUES are never returned by GET — only
// key names — so the panel lists what's stored without leaking material.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  if (!openBaoConfigured() || !openBaoSecrets.list) {
    return NextResponse.json({ configured: false, keys: [] });
  }
  const keys = await openBaoSecrets.list();
  return NextResponse.json({ configured: true, keys });
}

// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as { key?: unknown; value?: unknown } | null;
  if (!b || typeof b.key !== 'string' || typeof b.value !== 'string' || !b.key.trim()) {
    return NextResponse.json({ error: 'key and value (strings) required' }, { status: 400 });
  }
  if (!openBaoConfigured() || !openBaoSecrets.set) {
    return NextResponse.json({ error: 'OpenBao not configured' }, { status: 503 });
  }
  try {
    await openBaoSecrets.set(b.key.trim(), b.value);
    return NextResponse.json({ ok: true, key: b.key.trim() }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const key = new URL(req.url).searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'key query param required' }, { status: 400 });
  if (!openBaoConfigured() || !openBaoSecrets.remove) {
    return NextResponse.json({ error: 'OpenBao not configured' }, { status: 503 });
  }
  try {
    await openBaoSecrets.remove(key);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
