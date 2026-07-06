import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { KeycloakError, keycloakAdmin } from '@/lib/keycloak-admin';
import { createCustomRole, getCustomRoleByName } from '@/lib/store';
import { validateModules } from '@/lib/roles';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const url = new URL(req.url);
  const search = url.searchParams.get('search') ?? undefined;

  try {
    const clients = await kc.listClients(search);
    return NextResponse.json({ configured: true, clients });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const body = (await req.json().catch(() => null)) as {
    clientId?: string;
    name?: string;
    description?: string;
    serviceAccountsEnabled?: boolean;
    // Scope (ABAC/RBAC): pick an existing custom role AND/OR tick services to grant.
    roleName?: string;
    modules?: string[];
  } | null;

  if (!body?.clientId) {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  }

  // Validate the requested capabilities against the known module set before they become role
  // grants — an unvalidated body.modules would let a caller mint a role for arbitrary strings.
  const modules = validateModules(body.modules);
  if (modules.unknown.length) {
    return NextResponse.json(
      { error: `unknown module(s): ${modules.unknown.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const { id } = await kc.createClient({
      clientId: body.clientId,
      name: body.name,
      description: body.description,
      serviceAccountsEnabled: body.serviceAccountsEnabled,
    });

    // Generate initial secret
    const secret = await kc.regenerateClientSecret(id);

    // ── Scope the token (RBAC/ABAC) ────────────────────────────────────────────
    // Resolve the target role name: an ad-hoc svc-<clientId> role from ticked
    // services (modules), else an existing custom role. Ensure a console-side
    // custom role (name → module grants) + a matching Keycloak realm role, and
    // assign it to the client's service account so its JWT carries the scope.
    let scopedRole: string | null = null;
    if (modules.valid.length) {
      scopedRole = `svc-${body.clientId}`;
      if (!(await getCustomRoleByName(scopedRole))) {
        await createCustomRole({
          name: scopedRole,
          description: `Service scope for ${body.clientId}`,
          basedOn: 'viewer',
          capabilities: modules.valid,
        });
      }
    } else if (body.roleName) {
      scopedRole = body.roleName;
    }
    if (scopedRole && body.serviceAccountsEnabled) {
      const role = await kc.ensureRealmRole(scopedRole, `Off Grid scope: ${scopedRole}`);
      const saUser = await kc.getServiceAccountUser(id);
      if (saUser?.id) await kc.assignRoles(saUser.id, [role]);
    }

    const client = await kc.getClient(id);
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.machine.issue',
      resource: `client:${body.clientId}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, client, secret, scopedRole }, { status: 201 });
  } catch (err) {
    // Surface a conflict as 409 with the friendly message (e.g. "a client named X already exists")
    // instead of a generic 500 — the client with that ID is already registered.
    const status = err instanceof KeycloakError ? err.status : 500;
    const message =
      status === 409
        ? `A machine client with the ID "${body.clientId}" already exists. Pick a different Client ID, or manage the existing one below.`
        : (err as Error).message;
    return NextResponse.json({ error: message }, { status });
  }
}
