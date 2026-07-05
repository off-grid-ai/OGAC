import { NextResponse } from 'next/server';
import { openBaoConfigured, openBaoSecrets } from '@/lib/adapters/secrets';
import { requireAdmin } from '@/lib/authz';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import {
  audienceMapperConfig,
  audienceMapperName,
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
  const failures: { service: string; clientId: string; error: string }[] = [];

  // Provision each client independently: one client failing (e.g. a transient Keycloak error) must not
  // abort the other four. A failure is recorded and we move on, so the response reports exactly which
  // clients landed and which didn't rather than losing all progress to a single throw.
  for (const def of SERVICE_CLIENTS) {
    try {
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

      // ── 1b) Ensure the audience protocol mapper is attached ──────────────────
      // Without this, a runtime-created client emits the DEFAULT aud ("account") — never
      // offgrid-<svc>. Idempotent: find the mapper by name first, create only if absent. The seed
      // realm declares the same mapper so a fresh import is already correct; this repairs clients
      // the provisioning route created (which get no mappers by default).
      const mapperName = audienceMapperName(def);
      const existingMappers = await kc.listClientProtocolMappers(internalId);
      if (!existingMappers.some((m) => m.name === mapperName)) {
        await kc.createClientProtocolMapper(internalId, audienceMapperConfig(def));
      }

      // ── 2) Ensure the realm role(s) exist and are on the service account ─────
      // ensureRealmRole is idempotent; whether the role pre-existed tells us created vs reused.
      // A client may also carry an OPTIONAL grant role (least-privilege: only the gateway does) that
      // elevates its service account to a console capability — ensured and assigned the same way.
      const roleExisted = (await kc.listRealmRoles()).some((r) => r.name === def.realmRole);
      const role = await kc.ensureRealmRole(def.realmRole, `Off Grid service scope: ${def.realmRole}`);
      const roleAction: ProvisionAction = roleExisted ? 'reused' : 'created';
      const rolesToAssign = [role];
      if (def.grantsRole) {
        rolesToAssign.push(
          await kc.ensureRealmRole(def.grantsRole, `Off Grid console capability: ${def.grantsRole}`),
        );
      }
      const saUser = await kc.getServiceAccountUser(internalId);
      if (saUser?.id) {
        const assigned = await kc.listUserRoles(saUser.id);
        const missing = rolesToAssign.filter((r) => !assigned.some((a) => a.name === r.name));
        if (missing.length) await kc.assignRoles(saUser.id, missing);
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
    } catch (err) {
      failures.push({ service: def.service, clientId: def.clientId, error: (err as Error).message });
    }
  }

  // Secret VALUES are never returned — only the action + the OpenBao path they landed at.
  // 200 when all five succeed; 207 (Multi-Status) when some landed and some failed.
  const status = failures.length === 0 ? 200 : 207;
  return NextResponse.json(
    { configured: true, provisioned: results, ...(failures.length ? { failures } : {}) },
    { status },
  );
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
