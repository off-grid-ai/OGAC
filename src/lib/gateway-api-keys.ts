// I/O adapter for Keycloak-backed gateway API keys (task #74). Thin orchestration over the Keycloak
// Admin API (keycloak-admin.ts) + the pure policy/shaping in gateway-api-key.ts. NO local key store:
// each key is a Keycloak service-account client, so create/list/revoke are Keycloak operations and
// Keycloak is the single source of truth (revoke = disable the client → the aggregator's
// client_credentials exchange fails).
import { randomBytes } from 'node:crypto';
import { KeycloakError, type KeycloakAdminClient, type KcClient, keycloakAdmin } from '@/lib/keycloak-admin';
import {
  type GatewayKeyView,
  GATEWAY_KEY_SCOPE,
  deriveKeyClientId,
  formatApiKey,
  isGatewayKeyClient,
  mapKeyClient,
  sortKeyViews,
  validateKeyName,
} from '@/lib/gateway-api-key';

// Sentinel returned when Keycloak isn't configured — the routes surface `{ configured:false }` so the
// UI can render an honest "Keycloak not configured" state instead of a 500.
export const KEYCLOAK_UNCONFIGURED = Symbol('keycloak-unconfigured');
export type MaybeUnconfigured<T> = T | typeof KEYCLOAK_UNCONFIGURED;

export interface CreatedKey {
  view: GatewayKeyView;
  // The opaque `ogak_<clientId>.<secret>` — returned ONCE, never stored in cleartext (Keycloak holds
  // the hashed secret; we never persist the plaintext).
  apiKey: string;
}

// List every gateway API key in the realm (clients with the `ogak-` prefix), newest first. Never
// returns secrets. Best-effort last-used: pulled from each client's active sessions if available.
export async function listGatewayKeys(kc: KeycloakAdminClient = requireKc()): Promise<GatewayKeyView[]> {
  // Keycloak's ?clientId= filter is an EXACT match, so we can't prefix-filter server-side; list all
  // and filter by our prefix. Realms have few clients, so this is cheap.
  const clients = await kc.listClients();
  const keyClients = clients.filter((c) => isGatewayKeyClient(c));
  const rows = await Promise.all(keyClients.map((c) => toView(kc, c)));
  return sortKeyViews(rows);
}

async function toView(kc: KeycloakAdminClient, c: KcClient): Promise<GatewayKeyView> {
  const lastUsedAt = await lastUsed(kc, c.id);
  return mapKeyClient(
    { id: c.id, clientId: c.clientId, name: c.name, description: c.description, enabled: c.enabled, attributes: c.attributes },
    lastUsedAt,
  );
}

// Best-effort last-used: the most recent session start against the client. Keycloak exposes
// `lastAccess`/`start` on user-session reps; we read the max and ISO-format it. Any failure → null
// (last-used is informational, never load-bearing).
async function lastUsed(kc: KeycloakAdminClient, internalClientId: string): Promise<string | null> {
  try {
    const sessions = (await kc.listClientSessions(internalClientId, 0, 50)) as Array<Record<string, unknown>>;
    let max = 0;
    for (const s of sessions) {
      const t = Number(s.lastAccess ?? s.start ?? 0);
      if (Number.isFinite(t) && t > max) max = t;
    }
    return max > 0 ? new Date(max).toISOString() : null;
  } catch {
    return null;
  }
}

// Create a new Keycloak-backed gateway API key. Steps (all Keycloak):
//   1. derive a unique `ogak-<slug>-<rand>` clientId
//   2. create a confidential, service-accounts-enabled client carrying the label/owner/scope as
//      client attributes (so no separate store is needed)
//   3. read its generated client secret
//   4. compose the opaque `ogak_<clientId>.<secret>` returned ONCE
export async function createGatewayKey(input: {
  name: string;
  ownerOrg?: string;
  kc?: KeycloakAdminClient;
}): Promise<CreatedKey> {
  const kc = input.kc ?? requireKc();
  const nameCheck = validateKeyName(input.name);
  if (!nameCheck.ok) throw new KeycloakError(nameCheck.error ?? 'invalid name', 400);
  const name = nameCheck.name as string;
  const ownerOrg = (input.ownerOrg ?? 'default').trim() || 'default';

  const clientId = deriveKeyClientId(name, randomBytes(6).toString('hex'));
  const createdAt = new Date().toISOString();

  const { id } = await kc.createClient({
    clientId,
    name,
    description: `Gateway API key: ${name}`,
    serviceAccountsEnabled: true,
    directAccessGrantsEnabled: false,
    attributes: { label: name, ownerOrg, scope: GATEWAY_KEY_SCOPE, createdAt, offgridGatewayKey: 'true' },
  });

  const secret = await kc.getClientSecret(id);
  const client = await kc.getClient(id);
  const view = mapKeyClient(
    client
      ? { id: client.id, clientId: client.clientId, name: client.name, enabled: client.enabled, attributes: client.attributes }
      : { id, clientId, name, enabled: true, attributes: { label: [name], ownerOrg: [ownerOrg], scope: [GATEWAY_KEY_SCOPE], createdAt: [createdAt] } },
    null,
  );
  return { view, apiKey: formatApiKey(clientId, secret) };
}

// Revoke a key. Default is DISABLE (reversible, keeps the audit trail on the client); `hard:true`
// DELETES the client entirely. Either way the aggregator's client_credentials exchange fails after,
// so the key stops working immediately (Keycloak is the source of truth).
export async function revokeGatewayKey(
  id: string,
  opts: { hard?: boolean; kc?: KeycloakAdminClient } = {},
): Promise<void> {
  const kc = opts.kc ?? requireKc();
  // Guard: only ever touch clients that are actually gateway keys — never a service/OIDC client.
  const client = await kc.getClient(id);
  if (!client || !isGatewayKeyClient({ id: client.id, clientId: client.clientId })) {
    throw new KeycloakError('not a gateway API key', 404);
  }
  if (opts.hard) {
    await kc.deleteClient(id);
  } else {
    await kc.updateClient(id, { enabled: false });
  }
}

function requireKc(): KeycloakAdminClient {
  const kc = keycloakAdmin();
  if (!kc) throw new KeycloakError('Keycloak is not configured', 503);
  return kc;
}

// Whether Keycloak admin is configured at all — routes short-circuit to `{ configured:false }`.
export function keycloakConfigured(): boolean {
  return keycloakAdmin() !== null;
}
