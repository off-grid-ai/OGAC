import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import {
  extractLifetimes,
  mergeRealmLifetimes,
  validateLifetimesPatch,
} from '@/lib/keycloak-realm';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// GET → the realm's token/session lifetime settings (extracted from the full realm rep).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    const realm = await kc.getRealm();
    return NextResponse.json({ configured: true, lifetimes: extractLifetimes(realm) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PATCH → edit key lifetimes. CRITICAL: Keycloak's PUT replaces the whole realm rep, so we GET the
// current rep, merge only the validated lifetime fields (mergeRealmLifetimes), and PUT it back —
// never sending a bare patch that would reset every other realm setting to defaults.
export async function PATCH(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const validated = validateLifetimesPatch(body);
  if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: 400 });

  try {
    const current = await kc.getRealm();
    await kc.updateRealm(mergeRealmLifetimes(current, validated.patch));
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.realm.update_lifetimes',
      resource: `realm:${String(current.realm ?? '')}`,
      outcome: 'ok',
    });
    const refreshed = await kc.getRealm();
    return NextResponse.json({ configured: true, lifetimes: extractLifetimes(refreshed) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
