// Pure, zero-IO logic for the per-service Keycloak service-account clients that the service-token
// broker mints tokens for. Everything here is deterministic and side-effect free so it can be
// unit-tested without a live Keycloak / OpenBao. The IO orchestration (ensure-client, rotate-secret,
// write-to-OpenBao) lives in the thin provisioning route, which drives these definitions.
//
// The desired state is a fixed list: one confidential, service-accounts-enabled client per backend
// service. Each carries a realm role (assigned to the client's service-account user so the minted
// client_credentials JWT carries a usable role claim) and an audience (surfaced in the seed realm as
// an audience protocol mapper so the JWT's `aud` names the service the token is for).
//
// These identifiers are idempotency keys: provisioning finds-or-creates by clientId and the realm
// role by name, so they must never drift once shipped.

export interface ServiceClientDef {
  // The Keycloak clientId — also the OpenBao path segment (`secret/<service>/client-secret`).
  service: string;
  clientId: string;
  name: string;
  description: string;
  // Realm role assigned to the client's service-account user → appears in the token's role claim.
  realmRole: string;
  // Value the JWT `aud` claim should carry — the service the token is scoped to.
  audience: string;
}

// ── Desired state ─────────────────────────────────────────────────────────────
// One client per backend service the broker fronts. Confidential + serviceAccountsEnabled is implied
// for every entry (asserted by clientCreateConfig / the seed); it is not per-entry data.
export const SERVICE_CLIENTS: readonly ServiceClientDef[] = [
  {
    service: 'gateway',
    clientId: 'offgrid-gateway',
    name: 'Off Grid Gateway (service)',
    description: 'Service-account client for the AI gateway/aggregator.',
    realmRole: 'svc-gateway',
    audience: 'offgrid-gateway',
  },
  {
    service: 'opensearch',
    clientId: 'offgrid-opensearch',
    name: 'Off Grid OpenSearch (service)',
    description: 'Service-account client for OpenSearch access.',
    realmRole: 'svc-opensearch',
    audience: 'offgrid-opensearch',
  },
  {
    service: 'fleet',
    clientId: 'offgrid-fleet',
    name: 'Off Grid Fleet (service)',
    description: 'Service-account client for fleet management.',
    realmRole: 'svc-fleet',
    audience: 'offgrid-fleet',
  },
  {
    service: 'temporal',
    clientId: 'offgrid-temporal',
    name: 'Off Grid Temporal (service)',
    description: 'Service-account client for the Temporal workflow engine.',
    realmRole: 'svc-temporal',
    audience: 'offgrid-temporal',
  },
  {
    service: 'seaweedfs',
    clientId: 'offgrid-seaweedfs',
    name: 'Off Grid SeaweedFS (service)',
    description: 'Service-account client for SeaweedFS object storage.',
    realmRole: 'svc-seaweedfs',
    audience: 'offgrid-seaweedfs',
  },
] as const;

// clientId prefixes that MUST NOT be touched by provisioning — the console's own OIDC clients.
// Provisioning only ever operates on the SERVICE_CLIENTS list, but this is an explicit guard so a
// future edit to the list can never accidentally shadow the console's auth clients.
export const PROTECTED_CLIENT_IDS: readonly string[] = ['offgrid-console', 'offgrid-console-admin'];

export function isProtectedClientId(clientId: string): boolean {
  return PROTECTED_CLIENT_IDS.includes(clientId);
}

// The OpenBao KV path a service's client-secret is stored at (relative to the KV mount). Stable —
// this is the contract the service-token broker reads by.
export function clientSecretPath(service: string): string {
  if (!service || /[^a-z0-9-]/.test(service)) {
    throw new Error(`invalid service name for secret path: ${JSON.stringify(service)}`);
  }
  return `${service}/client-secret`;
}

// The Keycloak client-create body for a service client: always confidential (publicClient:false, set
// by keycloak-admin.createClient) with serviceAccountsEnabled. Standard/implicit/direct-access flows
// are off — client_credentials only.
export function clientCreateConfig(def: ServiceClientDef): {
  clientId: string;
  name: string;
  description: string;
  serviceAccountsEnabled: boolean;
  directAccessGrantsEnabled: boolean;
} {
  return {
    clientId: def.clientId,
    name: def.name,
    description: def.description,
    serviceAccountsEnabled: true,
    directAccessGrantsEnabled: false,
  };
}

export type ProvisionAction = 'created' | 'reused';
export type SecretAction = 'read' | 'rotated';

export interface ServiceClientResult {
  service: string;
  clientId: string;
  client: ProvisionAction;
  role: ProvisionAction;
  secret: SecretAction;
  secretPath: string;
}

// Build the record of what a single client's provisioning did. Pure so the route stays a thin shell
// over these decisions and the shape can be asserted in tests.
export function buildResult(
  def: ServiceClientDef,
  client: ProvisionAction,
  role: ProvisionAction,
  secret: SecretAction,
): ServiceClientResult {
  return {
    service: def.service,
    clientId: def.clientId,
    client,
    role,
    secret,
    secretPath: clientSecretPath(def.service),
  };
}

// Whether a secret should be rotated vs reused-and-read. Idempotency rule: only rotate when the caller
// explicitly asks (rotate=true) OR no usable secret exists yet. A present secret is left in place so
// re-running provisioning never churns live credentials the broker is already using.
export function shouldRotateSecret(existing: string | null | undefined, rotate: boolean): boolean {
  return rotate || !existing;
}
