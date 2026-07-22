import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import {
  describeOtpPolicy,
  extractOtpPolicy,
  mergeOtpPolicy,
  validateOtpPolicyPatch,
} from '@/lib/keycloak-federation';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Realm-wide MFA / OTP policy — the strength every user's authenticator must meet (TOTP vs HOTP,
// hash algorithm, digit count, time/counter window). Lives on the Keycloak realm representation;
// all shaping is the pure keycloak-federation.ts, the I/O is the public getRealm/updateRealm on the
// admin client (which is itself the network adapter). Mirrors access/realm/route.ts.

// GET → the realm's current OTP policy (extracted from the full realm rep, with catalog + summary).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    const realm = await kc.getRealm();
    const policy = extractOtpPolicy(realm);
    return NextResponse.json({ configured: true, policy, summary: describeOtpPolicy(policy) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PUT → update the OTP policy. CRITICAL: Keycloak's PUT replaces the whole realm rep, so we GET the
// current rep, merge only the validated OTP fields (mergeOtpPolicy), and PUT it back — never a bare
// patch that would reset every other realm setting to defaults.
export async function PUT(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const validated = validateOtpPolicyPatch(body);
  if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: 400 });

  try {
    const current = await kc.getRealm();
    await kc.updateRealm(mergeOtpPolicy(current, validated.patch));
    const refreshed = await kc.getRealm();
    const policy = extractOtpPolicy(refreshed);
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.mfa.update_otp_policy',
      resource: `realm:${String(current.realm ?? '')}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, policy, summary: describeOtpPolicy(policy) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
