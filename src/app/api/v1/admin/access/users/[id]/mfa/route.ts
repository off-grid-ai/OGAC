import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { keycloakAdmin, type KcUser } from '@/lib/keycloak-admin';
import {
  deriveMfaStatus,
  withConfigureOtp,
  withoutConfigureOtp,
  type KcRawCredential,
} from '@/lib/keycloak-realm';

export const dynamic = 'force-dynamic';

// GET → a user's MFA status (derived from their credentials).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    const creds = (await kc.listUserCredentials(id)) as KcRawCredential[];
    const user = await kc.getUser(id);
    return NextResponse.json({
      configured: true,
      mfa: deriveMfaStatus(creds),
      requiredActions: (user as (KcUser & { requiredActions?: string[] }) | null)?.requiredActions ?? [],
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST → enable the "Configure OTP" required action on the user (they set up TOTP on next login).
// Reads the current requiredActions first and merges (never clobbers) via the pure helper.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    const user = (await kc.getUser(id)) as (KcUser & { requiredActions?: string[] }) | null;
    if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 });
    await kc.setUserRequiredActions(id, withConfigureOtp(user.requiredActions));
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.mfa.require_otp',
      resource: `user:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE → either remove the "Configure OTP" required action (?action=require) or delete an existing
// OTP credential (?credentialId=…). Both are "turn MFA off" flavors an operator needs.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const url = new URL(req.url);
  const credentialId = url.searchParams.get('credentialId');

  try {
    if (credentialId) {
      await kc.deleteUserCredential(id, credentialId);
      auditFromSession(gate, await currentOrgId(), {
        action: 'access.mfa.remove_credential',
        resource: `user:${id}`,
        outcome: 'ok',
      });
    } else {
      const user = (await kc.getUser(id)) as (KcUser & { requiredActions?: string[] }) | null;
      if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 });
      await kc.setUserRequiredActions(id, withoutConfigureOtp(user.requiredActions));
      auditFromSession(gate, await currentOrgId(), {
        action: 'access.mfa.unrequire_otp',
        resource: `user:${id}`,
        outcome: 'ok',
      });
    }
    return NextResponse.json({ configured: true, ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
