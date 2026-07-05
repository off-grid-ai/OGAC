import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import { normalizeRequiredActions, type KcRawRequiredAction } from '@/lib/keycloak-realm';

export const dynamic = 'force-dynamic';

// GET → the realm's required-action providers (the MFA/policy view). Read-only here: enabling a
// required action realm-wide is an authentication-flow change that stays in the Keycloak admin
// console; the console enables OTP per-user (see users/[id]/mfa).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    const raw = (await kc.listRequiredActions()) as KcRawRequiredAction[];
    return NextResponse.json({ configured: true, requiredActions: normalizeRequiredActions(raw) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
