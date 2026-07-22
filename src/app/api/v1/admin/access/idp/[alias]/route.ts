import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { KeycloakError, keycloakAdmin } from '@/lib/keycloak-admin';
import {
  forbiddenGrantMessage,
  mergeIdpUpdate,
  normalizeIdpDetail,
  type IdpUpdatePatch,
  type KcRawIdp,
} from '@/lib/keycloak-realm';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// GET → a single identity provider's full (secret-redacted) config for the detail view.
export async function GET(req: Request, { params }: { params: Promise<{ alias: string }> }) {
  const { alias } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    const raw = (await kc.getIdentityProvider(alias)) as KcRawIdp | null;
    if (!raw) return NextResponse.json({ error: 'identity provider not found' }, { status: 404 });
    return NextResponse.json({ configured: true, provider: normalizeIdpDetail(raw) });
  } catch (err) {
    const status = err instanceof KeycloakError ? err.status : 500;
    const message = forbiddenGrantMessage('list-identity-providers', status, (err as Error).message);
    return NextResponse.json({ error: message }, { status });
  }
}

// PUT → update an identity provider (enable/disable, rename, edit config). CRITICAL: Keycloak's PUT
// replaces the whole rep, so we GET the current rep and merge only the changed fields (mergeIdpUpdate)
// — secrets left blank in the patch are preserved, never wiped.
export async function PUT(req: Request, { params }: { params: Promise<{ alias: string }> }) {
  const { alias } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const patch: IdpUpdatePatch = {};
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (typeof body.displayName === 'string') patch.displayName = body.displayName;
  if (body.config && typeof body.config === 'object') {
    patch.config = body.config as Record<string, string>;
  }

  try {
    const current = (await kc.getIdentityProvider(alias)) as KcRawIdp | null;
    if (!current) return NextResponse.json({ error: 'identity provider not found' }, { status: 404 });
    await kc.updateIdentityProvider(alias, mergeIdpUpdate(current, patch));
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.idp.update',
      resource: `idp:${alias}`,
      outcome: 'ok',
    });
    const refreshed = (await kc.getIdentityProvider(alias)) as KcRawIdp | null;
    return NextResponse.json({
      configured: true,
      ok: true,
      provider: refreshed ? normalizeIdpDetail(refreshed) : null,
    });
  } catch (err) {
    const status = err instanceof KeycloakError ? err.status : 500;
    const message = forbiddenGrantMessage('manage-identity-providers', status, (err as Error).message);
    return NextResponse.json({ error: message }, { status });
  }
}

// DELETE → remove an identity provider by alias.
export async function DELETE(req: Request, { params }: { params: Promise<{ alias: string }> }) {
  const { alias } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    await kc.deleteIdentityProvider(alias);
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.idp.delete',
      resource: `idp:${alias}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, ok: true });
  } catch (err) {
    const status = err instanceof KeycloakError ? err.status : 500;
    const message = forbiddenGrantMessage('manage-identity-providers', status, (err as Error).message);
    return NextResponse.json({ error: message }, { status });
  }
}
