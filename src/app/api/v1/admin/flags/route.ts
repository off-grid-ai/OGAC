import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { listFlags, setFlag } from '@/lib/store';

// A flag key is a lowercase, dash/dot-segmented identifier (e.g. agent-code-exec, online-evals).
const KEY_RE = /^[a-z0-9][a-z0-9._-]{1,62}$/;

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listFlags() });
}

// Create (or upsert) a flag with a description. Toggling an existing flag uses PATCH.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const key = typeof b?.key === 'string' ? b.key.trim() : '';
  if (!KEY_RE.test(key)) {
    return NextResponse.json(
      { error: 'key must be lowercase alphanumeric with - . _ (2–63 chars)' },
      { status: 400 },
    );
  }
  const enabled = b?.enabled !== false; // default on
  const description = typeof b?.description === 'string' ? b.description.trim().slice(0, 300) : '';
  await setFlag(key, enabled, description);
  return NextResponse.json({ key, enabled, description }, { status: 201 });
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
