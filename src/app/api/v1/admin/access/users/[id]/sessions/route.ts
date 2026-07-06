import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { KeycloakError, keycloakAdmin } from '@/lib/keycloak-admin';
import { forbiddenGrantMessage, mergeUserSessions, type KcRawSession } from '@/lib/keycloak-realm';

export const dynamic = 'force-dynamic';

// GET → a user's active Keycloak sessions (online + offline, normalized + sorted, IPs mDNS'd).
//
// Why both online AND offline: the console signs operators in via Keycloak's Direct-Access-Grant
// (ROPC) flow, not the browser SSO redirect (auth.config.ts deliberately owns the login form). That
// leaves only a short-lived ONLINE user session that the realm's idle timeout soon reaps — so a
// genuinely logged-in operator frequently shows zero online sessions ("No active sessions" while
// logged in — GAP #36). Merging in the OFFLINE (refresh-backed) sessions surfaces the live login.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    const online = (await kc.listUserSessions(id)) as KcRawSession[];

    // Offline sessions are exposed only per-client; fan out over the realm's clients (a small set).
    // Best-effort — a failure here must never sink the online listing.
    let offline: KcRawSession[] = [];
    try {
      const clients = await kc.listClients();
      const internalIds = clients.map((c) => c.id).filter(Boolean);
      offline = (await kc.listUserOfflineSessions(id, internalIds)) as KcRawSession[];
    } catch {
      offline = [];
    }

    return NextResponse.json({ configured: true, sessions: mergeUserSessions(online, offline) });
  } catch (err) {
    const status = err instanceof KeycloakError ? err.status : 500;
    const message = forbiddenGrantMessage('view-users', status, (err as Error).message);
    return NextResponse.json({ error: message }, { status });
  }
}

// DELETE → log the user out of ALL sessions (POST /users/{id}/logout under the hood).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    await kc.logoutUser(id);
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.session.logout',
      resource: `user:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, ok: true });
  } catch (err) {
    const status = err instanceof KeycloakError ? err.status : 500;
    const message = forbiddenGrantMessage('manage-users', status, (err as Error).message);
    return NextResponse.json({ error: message }, { status });
  }
}
