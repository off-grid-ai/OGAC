import { NextResponse } from 'next/server';
import { openBaoConfigured, openBaoSecrets } from '@/lib/adapters/secrets';
import { requireAdmin } from '@/lib/authz';
import { normalizeKeyList, validateKeyPath } from '@/lib/secret-keys';
import { readSecretsView } from '@/lib/secrets-view';

// OpenBao secrets management. Stores connector/tool credentials and virtual-key secrets in
// OpenBao KV v2 via the openBaoSecrets adapter. Secret VALUES are never returned by GET — only
// key NAMES (normalized) plus a STATUS model (reachable/sealed/version/mounts) — so callers see
// what's stored and the store's health without any secret material ever leaving OpenBao.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  // Read-only STATUS/METADATA model (sys endpoints only — never a secret value).
  const { data: status, error } = await readSecretsView();
  if (!openBaoConfigured() || !openBaoSecrets.list) {
    return NextResponse.json({ configured: false, keys: [], status, error });
  }
  const keys = normalizeKeyList(await openBaoSecrets.list());
  return NextResponse.json({ configured: true, keys, status, error });
}

// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as { key?: unknown; value?: unknown } | null;
  // Value must be a non-empty string, but is NEVER validated for content, echoed, logged, or
  // returned — only forwarded to the adapter's set().
  if (!b || typeof b.value !== 'string' || b.value.length === 0) {
    return NextResponse.json({ error: 'value (non-empty string) required' }, { status: 400 });
  }
  const v = validateKeyPath(b.key);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  if (!openBaoConfigured() || !openBaoSecrets.set) {
    return NextResponse.json({ error: 'OpenBao not configured' }, { status: 503 });
  }
  try {
    await openBaoSecrets.set(v.key, b.value);
    // Echo only the KEY name back — never the value.
    return NextResponse.json({ ok: true, key: v.key }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const v = validateKeyPath(new URL(req.url).searchParams.get('key'));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  if (!openBaoConfigured() || !openBaoSecrets.remove) {
    return NextResponse.json({ error: 'OpenBao not configured' }, { status: 503 });
  }
  try {
    await openBaoSecrets.remove(v.key);
    return NextResponse.json({ ok: true, key: v.key });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
