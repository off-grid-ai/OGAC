import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { managedCreateFlag, managedListFlags, managedSetEnabled } from '@/lib/flags-manager';
import { currentOrgId } from '@/lib/tenancy';

// A flag key is a lowercase, dash/dot-segmented identifier (e.g. agent-code-exec, online-evals).
const KEY_RE = /^[a-z0-9][a-z0-9._-]{1,62}$/;

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  // Drives Unleash when it's configured (URL + admin token), else the first-party DB. The
  // backend/environment fields let the UI show which source of truth is live.
  const { backend, environment, data } = await managedListFlags();
  return NextResponse.json({ object: 'list', backend, environment, data });
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
  const backend = await managedCreateFlag(key, enabled, description);
  auditFromSession(gate, await currentOrgId(), {
    action: 'flag.toggle',
    resource: `flag:${key}`,
    outcome: 'ok',
  });
  return NextResponse.json({ key, enabled, description, backend }, { status: 201 });
}

export async function PATCH(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as { key?: unknown; enabled?: unknown } | null;
  if (!b || typeof b.key !== 'string' || typeof b.enabled !== 'boolean') {
    return NextResponse.json({ error: 'key (string) + enabled (boolean) required' }, { status: 400 });
  }
  const backend = await managedSetEnabled(b.key, b.enabled);
  auditFromSession(gate, await currentOrgId(), {
    action: 'flag.toggle',
    resource: `flag:${b.key}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, backend });
}
