import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import { buildOidcIdpRep, normalizeIdps, type KcRawIdp } from '@/lib/keycloak-realm';

export const dynamic = 'force-dynamic';

// GET → configured identity providers (normalized).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    const raw = (await kc.listIdentityProviders()) as KcRawIdp[];
    return NextResponse.json({ configured: true, providers: normalizeIdps(raw) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST → add an OIDC identity provider. We support the common OIDC authorization-code case; SAML and
// advanced mapper config stay in the Keycloak admin console (validated/built by buildOidcIdpRep).
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const built = buildOidcIdpRep({
    alias: String(body.alias ?? ''),
    displayName: body.displayName ? String(body.displayName) : undefined,
    authorizationUrl: String(body.authorizationUrl ?? ''),
    tokenUrl: String(body.tokenUrl ?? ''),
    clientId: String(body.clientId ?? ''),
    clientSecret: String(body.clientSecret ?? ''),
  });
  if ('error' in built) return NextResponse.json({ error: built.error }, { status: 400 });

  try {
    await kc.createIdentityProvider(built.rep);
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.idp.create',
      resource: `idp:${built.rep.alias}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, ok: true }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
