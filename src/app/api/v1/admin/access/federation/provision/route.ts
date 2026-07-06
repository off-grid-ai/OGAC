import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { KeycloakError, keycloakAdmin } from '@/lib/keycloak-admin';
import {
  REALM_MANAGEMENT_CLIENT,
  federationGrantCommand,
  federationGrantRoleNames,
  serviceAccountUsername,
} from '@/lib/keycloak-realm';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// POST → self-heal the federation grant (GAP #40). Grants the console's OWN admin service-account the
// realm-management client roles `view-identity-providers` + `manage-identity-providers` so a FRESH
// realm can read/write identity-provider federation without an operator hand-granting the role first.
//
// This is a real grant, not a fake: it finds the SA user, resolves the realm-management client's role
// objects, and POSTs the role mapping. It only works if the console's admin client is itself allowed
// to grant those roles (needs manage-users + view-/manage-clients on realm-management — i.e. a broad
// realm-admin). If Keycloak 403s the grant itself, we DON'T pretend — we return the exact kcadm
// command so the operator can do it by hand. The live server already has the grant, so on prod this
// is a no-op that returns { alreadyGranted: true }.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  const clientId = process.env.OFFGRID_KEYCLOAK_ADMIN_CLIENT_ID;
  if (!kc || !clientId) return NextResponse.json({ configured: false }, { status: 200 });

  const saUsername = serviceAccountUsername(clientId);
  const wantRoles = federationGrantRoleNames();

  try {
    // 1) The service-account user backing the console's admin client.
    const users = await kc.listUsers(saUsername, 0, 5);
    const sa = users.find((u) => u.username === saUsername) ?? users[0];
    if (!sa) {
      return NextResponse.json(
        {
          error: `Could not find the admin service-account user "${saUsername}". Enable service accounts on client ${clientId}.`,
          manualCommand: federationGrantCommand(clientId),
        },
        { status: 404 },
      );
    }

    // 2) The realm-management client + its role objects (roles carry the id the mapping needs).
    const [rmClient] = await kc.listClients(REALM_MANAGEMENT_CLIENT);
    if (!rmClient) {
      return NextResponse.json(
        { error: `The "${REALM_MANAGEMENT_CLIENT}" client was not found in this realm.` },
        { status: 404 },
      );
    }
    const clientRoles = await kc.listClientRoles(rmClient.id);
    const toGrant = wantRoles
      .map((name) => clientRoles.find((r) => r.name === name))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    if (toGrant.length !== wantRoles.length) {
      const missing = wantRoles.filter((n) => !clientRoles.some((r) => r.name === n));
      return NextResponse.json(
        { error: `realm-management is missing expected roles: ${missing.join(', ')}.` },
        { status: 500 },
      );
    }

    // 3) Skip roles already held — report a clean no-op on the live/already-provisioned realm.
    const held = await kc.listUserClientRoles(sa.id, rmClient.id);
    const needed = toGrant.filter((r) => !held.some((h) => h.name === r.name));
    if (needed.length === 0) {
      return NextResponse.json({ ok: true, alreadyGranted: true, roles: wantRoles });
    }

    // 4) The actual self-heal.
    await kc.assignClientRoles(sa.id, rmClient.id, needed);
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.federation.provision',
      resource: `service-account:${saUsername}`,
      outcome: 'ok',
    });
    return NextResponse.json({ ok: true, granted: needed.map((r) => r.name), roles: wantRoles });
  } catch (err) {
    const status = err instanceof KeycloakError ? err.status : 500;
    // A 403 HERE means the console's admin client can't grant roles to itself (it lacks realm-admin).
    // Don't fake success — hand back the exact manual command so the bootstrap is one paste, not a hunt.
    if (status === 403) {
      return NextResponse.json(
        {
          error:
            `The console's admin service-account cannot grant its own realm-management roles ` +
            `(needs manage-users + view/manage-clients on ${REALM_MANAGEMENT_CLIENT}). Run this once by hand:`,
          manualCommand: federationGrantCommand(clientId),
        },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
