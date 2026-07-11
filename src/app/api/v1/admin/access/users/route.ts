import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { keycloakAdmin, type KcRole } from '@/lib/keycloak-admin';
import { listUsers } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';
import { orgMemberEmailSet, scopeKeycloakUsersToOrg } from '@/lib/user-scope';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const url = new URL(req.url);
  const search = url.searchParams.get('search') ?? undefined;
  const first = url.searchParams.has('first') ? Number(url.searchParams.get('first')) : undefined;
  const max = url.searchParams.has('max') ? Number(url.searchParams.get('max')) : undefined;

  try {
    const users = await kc.listUsers(search, first, max);
    // TENANT ISOLATION (SURFACE-1): Keycloak is a REALM-WIDE store, so its user list mixes every
    // tenant + internal staff. Org membership is owned by the console DB (users.org_id) — the same
    // source sign-in/currentOrgId trust — so intersect the realm list with THIS org's members. On
    // the default/single-tenant org the realm IS the tenant, so we don't intersect (unchanged).
    const org = await currentOrgId();
    const scoped = org !== DEFAULT_ORG;
    const orgEmails = scoped ? orgMemberEmailSet(await listUsers(org)) : new Set<string>();
    return NextResponse.json({
      configured: true,
      users: scopeKeycloakUsersToOrg(users, orgEmails, scoped),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const email = body.email as string | undefined;
  const firstName = body.firstName as string | undefined;
  const lastName = body.lastName as string | undefined;
  const password = body.password as string | undefined;
  const temporary = (body.temporary as boolean | undefined) ?? false;
  const roles = body.roles as KcRole[] | undefined;

  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });
  if (!password) return NextResponse.json({ error: 'password is required' }, { status: 400 });

  const org = await currentOrgId();
  try {
    const user = await kc.createUser({
      username: email,
      email,
      firstName,
      lastName,
      enabled: true,
      credentials: [{ type: 'password', value: password, temporary }],
    });

    if (roles && roles.length > 0) {
      await kc.assignRoles(user.id, roles);
    }

    auditFromSession(gate, org, {
      action: 'access.user.change',
      resource: `user:${email}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, user }, { status: 201 });
  } catch (err) {
    auditFromSession(gate, org, {
      action: 'access.user.change',
      resource: `user:${email}`,
      outcome: 'error',
    });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
