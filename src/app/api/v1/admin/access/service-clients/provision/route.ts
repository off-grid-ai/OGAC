import { NextResponse } from 'next/server';
import { openBaoConfigured, openBaoSecrets } from '@/lib/adapters/secrets';
import { requireAdmin } from '@/lib/authz';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import {
  buildResult,
  clientCreateConfig,
  clientSecretPath,
  SERVICE_CLIENTS,
  shouldRotateSecret,
  type ProvisionAction,
  type SecretAction,
  type ServiceClientResult,
} from '@/lib/service-clients';

export const dynamic = 'force-dynamic';

// Provision (or re-provision) the per-service Keycloak service-account clients that the service-token
// broker mints tokens for, and store each client-secret in OpenBao at secret/<service>/client-secret.
//
// Thin shell: the desired state and every decision (which config to POST, whether to rotate) live in
// the pure src/lib/service-clients module; the IO (ensure-client, ensure-role, secret, OpenBao write)
// reuses keycloak-admin.ts and the openBaoSecrets adapter — no hand-rolled admin/OpenBao calls here.
//
// Idempotent: reuses an existing client by clientId, reuses an existing realm role by name, and leaves
// a present secret in place (reads it) unless `rotate:true` is passed. Re-running is a no-op churn-wise.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false, error: 'Keycloak not configured' }, { status: 503 });
  if (!openBaoConfigured() || !openBaoSecrets.set) {
    return NextResponse.json({ configured: false, error: 'OpenBao not configured' }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as { rotate?: boolean } | null;
  const rotate = body?.rotate === true;

  const results: ServiceClientResult[] = [];

  try {
    for (const def of SERVICE_CLIENTS) {
      // ── 1) Ensure the client exists (find-or-create by clientId) ─────────────
      let clientAction: ProvisionAction;
      const existing = (await kc.listClients(def.clientId)).find((c) => c.clientId === def.clientId);
      let internalId: string;
      if (existing) {
        internalId = existing.id;
        clientAction = 'reused';
      } else {
        const created = await kc.createClient(clientCreateConfig(def));
        internalId = created.id;
        clientAction = 'created';
      }

      // ── 2) Ensure the realm role exists and is on the service account ────────
      // ensureRealmRole is idempotent; whether the role pre-existed tells us created vs reused.
      const roleExisted = (await kc.listRealmRoles()).some((r) => r.name === def.realmRole);
      const role = await kc.ensureRealmRole(def.realmRole, `Off Grid service scope: ${def.realmRole}`);
      const roleAction: ProvisionAction = roleExisted ? 'reused' : 'created';
      const saUser = await kc.getServiceAccountUser(internalId);
      if (saUser?.id) {
        const assigned = await kc.listUserRoles(saUser.id);
        if (!assigned.some((r) => r.name === def.realmRole)) {
          await kc.assignRoles(saUser.id, [role]);
        }
      }

      // ── 3) Read or rotate the client-secret ──────────────────────────────────
      let secretAction: SecretAction;
      let secret: string;
      const current = existing ? await kc.getClientSecret(internalId).catch(() => null) : null;
      if (shouldRotateSecret(current, rotate)) {
        secret = await kc.regenerateClientSecret(internalId);
        secretAction = 'rotated';
      } else {
        secret = current as string;
        secretAction = 'read';
      }

      // ── 4) Persist the secret into OpenBao at secret/<service>/client-secret ──
      await openBaoSecrets.set(clientSecretPath(def.service), secret);

      results.push(buildResult(def, clientAction, roleAction, secretAction));
    }
  } catch (err) {
    return NextResponse.json(
      { configured: true, error: (err as Error).message, partial: results },
      { status: 500 },
    );
  }

  // Secret VALUES are never returned — only the action + the OpenBao path they landed at.
  return NextResponse.json({ configured: true, provisioned: results });
}

// Report desired-state vs what actually exists in Keycloak, without mutating anything.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    const all = await kc.listClients();
    const byId = new Set(all.map((c) => c.clientId));
    const clients = SERVICE_CLIENTS.map((def) => ({
      service: def.service,
      clientId: def.clientId,
      realmRole: def.realmRole,
      audience: def.audience,
      secretPath: clientSecretPath(def.service),
      exists: byId.has(def.clientId),
    }));
    return NextResponse.json({ configured: true, clients });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
