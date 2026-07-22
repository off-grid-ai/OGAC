import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { KeycloakError, keycloakAdmin } from '@/lib/keycloak-admin';
import {
  buildOidcIdpRep,
  buildSamlIdpRep,
  forbiddenGrantMessage,
  normalizeIdps,
  type KcRawIdp,
} from '@/lib/keycloak-realm';
import { currentOrgId } from '@/lib/tenancy';

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
    const status = err instanceof KeycloakError ? err.status : 500;
    const message = forbiddenGrantMessage('list-identity-providers', status, (err as Error).message);
    return NextResponse.json({ error: message }, { status });
  }
}

// POST → add an identity provider. `type: "saml"` builds a SAML v2 provider; anything else (default)
// builds the common OIDC authorization-code provider. Both are validated/built by the pure builders;
// advanced mapper/signing-cert config stays in the identity provider's own admin console.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const built =
    String(body.type ?? 'oidc') === 'saml'
      ? buildSamlIdpRep({
          alias: String(body.alias ?? ''),
          displayName: body.displayName ? String(body.displayName) : undefined,
          singleSignOnServiceUrl: String(body.singleSignOnServiceUrl ?? ''),
          entityId: body.entityId ? String(body.entityId) : undefined,
          singleLogoutServiceUrl: body.singleLogoutServiceUrl
            ? String(body.singleLogoutServiceUrl)
            : undefined,
        })
      : buildOidcIdpRep({
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
    const status = err instanceof KeycloakError ? err.status : 500;
    const message = forbiddenGrantMessage('manage-identity-providers', status, (err as Error).message);
    return NextResponse.json({ error: message }, { status });
  }
}
