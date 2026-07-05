import { NextResponse } from 'next/server';
import {
  baoDbCreds,
  baoDbRoles,
  openBaoConfigured,
  openBaoDbMount,
} from '@/lib/adapters/secrets';
import { requireAdmin } from '@/lib/authz';
import { validateRoleName } from '@/lib/secrets-ops';

export const dynamic = 'force-dynamic';

// Dynamic DATABASE secrets. Configured roles are enumerated (names only); generating creds mints a
// short-lived, lease-bound username/password on demand. Those creds ARE returned (once) because
// handing the operator a freshly-minted ephemeral credential is the entire purpose of a dynamic
// secret — nothing is stored or listed by the console. The role name never carries secret material.
//
// This requires the `database` secrets engine enabled at OFFGRID_OPENBAO_DB_MOUNT (default
// "database") with at least one role configured against a connection. If the engine is absent,
// GET returns an empty role list and the UI notes that dynamic DB secrets aren't provisioned.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  if (!openBaoConfigured()) {
    return NextResponse.json({ configured: false, mount: openBaoDbMount(), roles: [] });
  }
  const roles = await baoDbRoles();
  return NextResponse.json({ configured: true, mount: openBaoDbMount(), roles });
}

// POST { role } → generate on-demand creds for the role.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  if (!openBaoConfigured()) {
    return NextResponse.json({ error: 'OpenBao not configured' }, { status: 503 });
  }
  const b = (await req.json().catch(() => null)) as { role?: unknown } | null;
  const v = validateRoleName(b?.role);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  try {
    const creds = await baoDbCreds(v.role);
    return NextResponse.json({ ok: true, role: v.role, creds }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
