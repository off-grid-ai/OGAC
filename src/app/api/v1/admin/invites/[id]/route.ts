import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { listTenants } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import {
  createInvite,
  deleteInvite,
  getInviteById,
  revokeInvite,
  sendInviteEmail,
} from '@/lib/user-invites';
import { baseUrlFromHeaders } from '@/lib/user-invites-policy';

export const dynamic = 'force-dynamic';

// ─── USER INVITES — a single invite (org-scoped, admin-gated, audited) ───────────────────────────────
// GET    → the invite (no token material).
// PATCH  → { action: 'revoke' }  → revoke a pending invite.
//          { action: 'resend' }  → mint a FRESH token (single-use, so the old link can't be reused),
//                                   reset expiry to pending, and re-send the email.
// DELETE → remove the invite outright.

async function resolveId(params: Promise<{ id: string }>): Promise<string> {
  return (await params).id;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const invite = await getInviteById(await resolveId(params), orgId);
  if (!invite) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(invite);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const id = await resolveId(params);
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  const action = body?.action;

  const existing = await getInviteById(id, orgId);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (action === 'revoke') {
    const updated = await revokeInvite(id, orgId);
    auditFromSession(gate, orgId, {
      action: 'access.invite.revoke',
      resource: `invite:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json(updated);
  }

  if (action === 'resend') {
    if (existing.status !== 'pending') {
      return NextResponse.json(
        { error: `only a pending invite can be resent (this one is ${existing.status})` },
        { status: 409 },
      );
    }
    // Mint a NEW invite (fresh single-use token + reset expiry) and revoke the old one so the prior
    // link can no longer be redeemed. Same email/role/grants.
    const { invite, token } = await createInvite({
      orgId,
      email: existing.email,
      role: existing.role,
      appGrants: existing.appGrants,
      invitedBy: gate.user.email ?? existing.invitedBy,
    });
    await revokeInvite(id, orgId);

    const tenant = (await listTenants().catch(() => [])).find((t) => t.id === orgId);
    const baseUrl = baseUrlFromHeaders((n) => req.headers.get(n), process.env.OFFGRID_CONSOLE_URL);
    const sent = await sendInviteEmail({
      invite,
      token,
      baseUrl,
      orgName: tenant?.name ?? orgId,
      invitedByName: gate.user.name ?? gate.user.email ?? undefined,
    });
    auditFromSession(gate, orgId, {
      action: 'access.invite.resend',
      resource: `invite:${invite.id}`,
      outcome: sent.ok ? 'ok' : 'error',
    });
    return NextResponse.json({ invite, emailed: sent.ok, emailReason: sent.reason });
  }

  return NextResponse.json({ error: "action must be 'revoke' or 'resend'" }, { status: 400 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const id = await resolveId(params);
  const removed = await deleteInvite(id, orgId);
  if (!removed) return NextResponse.json({ error: 'not found' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'access.invite.delete',
    resource: `invite:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ deleted: true });
}
