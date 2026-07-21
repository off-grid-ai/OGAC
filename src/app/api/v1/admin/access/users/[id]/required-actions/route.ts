import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { keycloakAdmin, type KcUser } from '@/lib/keycloak-admin';
import {
  isKnownRequiredAction,
  withRequiredAction,
  withoutRequiredAction,
} from '@/lib/keycloak-realm';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The generalized user required-actions surface (VERIFY_EMAIL, UPDATE_PASSWORD, CONFIGURE_TOTP,
// UPDATE_PROFILE). The OTP-specific /mfa route stays for the credential view; this route toggles any
// CURATED required action. Both read the user's current requiredActions first and merge via the pure
// helper (Keycloak's user PUT replaces the array wholesale, so we always send the full set).

type Ctx = { params: Promise<{ id: string }> };

// Only a curated action alias may be written — guards against arbitrary required-action injection.
function readAction(body: { action?: unknown } | null): string | null {
  const action = typeof body?.action === 'string' ? body.action : '';
  return action && isKnownRequiredAction(action) ? action : null;
}

async function currentRequiredActions(
  kc: NonNullable<ReturnType<typeof keycloakAdmin>>,
  id: string,
): Promise<string[] | { notFound: true }> {
  const user = (await kc.getUser(id)) as (KcUser & { requiredActions?: string[] }) | null;
  if (!user) return { notFound: true };
  return user.requiredActions ?? [];
}

// POST → require a curated action on the user (they must complete it on next login).
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  const action = readAction(body);
  if (!action) return NextResponse.json({ error: 'unknown or missing required action' }, { status: 400 });

  try {
    const existing = await currentRequiredActions(kc, id);
    if ('notFound' in existing) return NextResponse.json({ error: 'user not found' }, { status: 404 });
    await kc.setUserRequiredActions(id, withRequiredAction(existing, action));
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.user.require_action',
      resource: `user:${id}:${action}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE → clear a curated required action (?action=VERIFY_EMAIL).
export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const action = new URL(req.url).searchParams.get('action') ?? '';
  if (!isKnownRequiredAction(action)) {
    return NextResponse.json({ error: 'unknown or missing required action' }, { status: 400 });
  }

  try {
    const existing = await currentRequiredActions(kc, id);
    if ('notFound' in existing) return NextResponse.json({ error: 'user not found' }, { status: 404 });
    await kc.setUserRequiredActions(id, withoutRequiredAction(existing, action));
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.user.unrequire_action',
      resource: `user:${id}:${action}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
