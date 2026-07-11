import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { listTenants } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { createInvite, listInvites, sendInviteEmail } from '@/lib/user-invites';
import { baseUrlFromHeaders, validateInviteCreate } from '@/lib/user-invites-policy';

export const dynamic = 'force-dynamic';

// ─── USER INVITES — admin/creator collection (org-scoped, admin-gated, audited) ──────────────────────
// GET  → list this org's invites (pending/accepted/revoked/expired), no token material exposed.
// POST → create an invite (email + org role + optional app grants), then SEND the accept-link email
//        via the Resend sink. Pure validation lives in user-invites-policy; persistence + provisioning
//        + send in user-invites.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  return NextResponse.json({ object: 'list', data: await listInvites(orgId) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const check = validateInviteCreate({
    email: body?.email,
    role: body?.role,
    appGrants: body?.appGrants ?? body?.app_grants,
  });
  if (!check.ok || !check.value) {
    return NextResponse.json({ error: check.errors.join('; '), errors: check.errors }, { status: 400 });
  }

  const orgId = await currentOrgId();
  const invitedBy = gate.user.email ?? 'admin';

  const { invite, token } = await createInvite({
    orgId,
    email: check.value.email,
    role: check.value.role,
    appGrants: check.value.appGrants,
    invitedBy,
  });

  // Resolve the tenant display name (for the branded email) + the console origin for the accept link.
  const tenant = (await listTenants().catch(() => [])).find((t) => t.id === orgId);
  const orgName = tenant?.name ?? orgId;
  const baseUrl = baseUrlFromHeaders((n) => req.headers.get(n), process.env.OFFGRID_CONSOLE_URL);

  const sent = await sendInviteEmail({
    invite,
    token,
    baseUrl,
    orgName,
    invitedByName: gate.user.name ?? invitedBy,
  });

  auditFromSession(gate, orgId, {
    action: 'access.invite.create',
    resource: `invite:${invite.id}`,
    outcome: sent.ok ? 'ok' : 'error',
  });

  return NextResponse.json(
    { invite, emailed: sent.ok, emailConfigured: sent.configured, emailReason: sent.reason },
    { status: 201 },
  );
}
