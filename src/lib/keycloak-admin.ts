// Typed Keycloak Admin REST API client with in-process token caching.
//
// Env vars:
//   OFFGRID_KEYCLOAK_URL               e.g. https://auth.example.com
//   OFFGRID_KEYCLOAK_REALM             e.g. offgrid
//   OFFGRID_KEYCLOAK_ADMIN_CLIENT_ID   service-account client id
//   OFFGRID_KEYCLOAK_ADMIN_CLIENT_SECRET

export interface KcUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified?: boolean;
  realmRoles?: string[];
  attributes?: Record<string, string[]>;
}

export interface KcRole {
  id: string;
  name: string;
  description?: string;
}

export interface KcClient {
  id: string;
  clientId: string;
  name?: string;
  description?: string;
  enabled: boolean;
  publicClient: boolean;
  serviceAccountsEnabled: boolean;
  secret?: string;
  attributes?: Record<string, string[] | string>;
}

export interface KcProtocolMapper {
  id?: string;
  name: string;
  protocol: string;
  protocolMapper: string;
  config?: Record<string, string>;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number; // ms epoch
}

// Error carrying the upstream Keycloak HTTP status so routes can map it to the right response.
export class KeycloakError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'KeycloakError';
    this.status = status;
  }
}

// Parse a Keycloak success response body as JSON, tolerating an EMPTY body.
//
// Keycloak's write endpoints routinely answer with no JSON payload:
//   • POST /clients, POST /roles, POST /users → 201 Created, body empty (id is in the Location header)
//   • PUT (update), DELETE, POST/DELETE role-mappings → 204 No Content
// Calling `res.json()` on any of those throws "Unexpected end of JSON input". This helper checks the
// status and Content-Length first and returns `undefined` for a body-less response, so callers that
// don't need a payload (fetchJson<void>) never trip over an empty body. Pure over a Response — unit-testable.
export async function parseKcBody<T>(res: Response): Promise<T> {
  // 204 No Content and 201 Created (Keycloak create endpoints) carry no JSON body.
  if (res.status === 204 || res.status === 201) return undefined as unknown as T;
  const len = res.headers.get('content-length');
  if (len === '0') return undefined as unknown as T;
  // Fall back to reading the text so a spurious empty body (no Content-Length header) is tolerated too.
  const text = await res.text();
  if (text.trim() === '') return undefined as unknown as T;
  return JSON.parse(text) as T;
}

async function parseKcError(res: Response): Promise<Error> {
  // 409 on create = the clientId/username already exists. Keycloak's 409 body is usually empty,
  // so synthesize a human message instead of a bare "HTTP 409".
  if (res.status === 409) {
    return new KeycloakError('Already exists — pick a different ID (that one is taken).', 409);
  }
  // 403 = the console's admin service-account is authenticated but LACKS the realm-management role
  // for this operation. Keycloak's 403 body is empty, so a bare "HTTP 403 Forbidden" leaks up (GAP
  // #37). Carry the status; routes turn it into an operation-specific, actionable message via
  // forbiddenGrantMessage() in keycloak-realm.ts.
  if (res.status === 403) {
    return new KeycloakError('Forbidden — the console admin account is missing a Keycloak role.', 403);
  }
  try {
    const body = (await res.json()) as { error?: string; error_description?: string; errorMessage?: string };
    return new KeycloakError(
      body.error_description ?? body.errorMessage ?? body.error ?? `HTTP ${res.status}`,
      res.status,
    );
  } catch {
    return new KeycloakError(`HTTP ${res.status}`, res.status);
  }
}

export class KeycloakAdminClient {
  private readonly baseUrl: string;
  private readonly tokenUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private tokenCache: TokenCache | null = null;

  constructor(keycloakUrl: string, realm: string, clientId: string, clientSecret: string) {
    this.baseUrl = `${keycloakUrl}/admin/realms/${realm}`;
    this.tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  // ── Token management ──────────────────────────────────────────────────────

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt - now > 30_000) {
      return this.tokenCache.accessToken;
    }

    const res = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!res.ok) {
      throw await parseKcError(res);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.tokenCache = {
      accessToken: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };
    return data.access_token;
  }

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getToken();
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  }

  private async fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetch(path, init);
    if (!res.ok) throw await parseKcError(res);
    // Tolerates empty bodies (201 create / 204 update-delete-roleassign) instead of throwing on res.json().
    return parseKcBody<T>(res);
  }

  private async fetchNullable<T>(path: string): Promise<T | null> {
    const res = await this.fetch(path);
    if (res.status === 404) return null;
    if (!res.ok) throw await parseKcError(res);
    return res.json() as Promise<T>;
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  async listUsers(search?: string, first?: number, max?: number): Promise<KcUser[]> {
    const params = new URLSearchParams();
    if (search !== undefined) params.set('search', search);
    if (first !== undefined) params.set('first', String(first));
    if (max !== undefined) params.set('max', String(max));
    const qs = params.toString() ? `?${params}` : '';
    return this.fetchJson<KcUser[]>(`/users${qs}`);
  }

  async getUser(id: string): Promise<KcUser | null> {
    return this.fetchNullable<KcUser>(`/users/${id}`);
  }

  async createUser(data: {
    username: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    enabled?: boolean;
    credentials?: { type: string; value: string; temporary: boolean }[];
  }): Promise<KcUser> {
    const res = await this.fetch('/users', {
      method: 'POST',
      body: JSON.stringify({ enabled: true, ...data }),
    });
    if (!res.ok) throw await parseKcError(res);

    // Keycloak returns 201 + Location: .../users/<new-id>
    const location = res.headers.get('location') ?? '';
    const newId = location.split('/').pop() ?? '';

    if (!newId) {
      // Fallback: search by username
      const users = await this.listUsers(data.username, 0, 1);
      const found = users.find((u) => u.username === data.username);
      if (!found) throw new Error('User created but could not be retrieved');
      return found;
    }

    const user = await this.getUser(newId);
    if (!user) throw new Error('User created but could not be retrieved');
    return user;
  }

  async updateUser(id: string, data: Partial<KcUser>): Promise<void> {
    await this.fetchJson<void>(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteUser(id: string): Promise<void> {
    const res = await this.fetch(`/users/${id}`, { method: 'DELETE' });
    if (!res.ok) throw await parseKcError(res);
  }

  async resetPassword(id: string, password: string, temporary = false): Promise<void> {
    await this.fetchJson<void>(`/users/${id}/reset-password`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'password', value: password, temporary }),
    });
  }

  // ── User roles ────────────────────────────────────────────────────────────

  async listUserRoles(id: string): Promise<KcRole[]> {
    return this.fetchJson<KcRole[]>(`/users/${id}/role-mappings/realm`);
  }

  async assignRoles(userId: string, roles: KcRole[]): Promise<void> {
    await this.fetchJson<void>(`/users/${userId}/role-mappings/realm`, {
      method: 'POST',
      body: JSON.stringify(roles),
    });
  }

  async removeRoles(userId: string, roles: KcRole[]): Promise<void> {
    await this.fetchJson<void>(`/users/${userId}/role-mappings/realm`, {
      method: 'DELETE',
      body: JSON.stringify(roles),
    });
  }

  // ── User client-role mappings ───────────────────────────────────────────────
  // Realm roles (above) live on /realm; a CLIENT's roles (e.g. realm-management's fine-grained
  // view-/manage-identity-providers) live under /clients/{internalClientId}. Used by the federation
  // self-heal to grant the console's own service-account the realm-management roles it needs.

  // The roles the given client defines. GET /clients/{internalClientId}/roles.
  async listClientRoles(internalClientId: string): Promise<KcRole[]> {
    return this.fetchJson<KcRole[]>(`/clients/${internalClientId}/roles`);
  }

  // A user's currently-assigned roles FROM a specific client. GET
  // /users/{id}/role-mappings/clients/{internalClientId}.
  async listUserClientRoles(userId: string, internalClientId: string): Promise<KcRole[]> {
    return this.fetchJson<KcRole[]>(`/users/${userId}/role-mappings/clients/${internalClientId}`);
  }

  // Grant a user client roles. POST /users/{id}/role-mappings/clients/{internalClientId}. Idempotent
  // in Keycloak (re-granting an already-held role is a no-op 204).
  async assignClientRoles(userId: string, internalClientId: string, roles: KcRole[]): Promise<void> {
    await this.fetchJson<void>(`/users/${userId}/role-mappings/clients/${internalClientId}`, {
      method: 'POST',
      body: JSON.stringify(roles),
    });
  }

  // ── Realm roles ───────────────────────────────────────────────────────────

  async listRealmRoles(): Promise<KcRole[]> {
    return this.fetchJson<KcRole[]>('/roles');
  }

  async createRealmRole(name: string, description?: string): Promise<void> {
    await this.fetchJson<void>('/roles', {
      method: 'POST',
      body: JSON.stringify({ name, ...(description ? { description } : {}) }),
    });
  }

  async deleteRealmRole(name: string): Promise<void> {
    const res = await this.fetch(`/roles/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!res.ok) throw await parseKcError(res);
  }

  // ── Clients ───────────────────────────────────────────────────────────────

  async listClients(search?: string): Promise<KcClient[]> {
    const qs = search ? `?clientId=${encodeURIComponent(search)}` : '';
    return this.fetchJson<KcClient[]>(`/clients${qs}`);
  }

  async getClient(id: string): Promise<KcClient | null> {
    return this.fetchNullable<KcClient>(`/clients/${id}`);
  }

  async createClient(data: {
    clientId: string;
    name?: string;
    description?: string;
    serviceAccountsEnabled?: boolean;
    directAccessGrantsEnabled?: boolean;
    // Free-form client attributes (Keycloak stores these on the client rep). Used to carry a gateway
    // API key's label/owner/createdAt/scope alongside the client itself — no separate store needed.
    attributes?: Record<string, string>;
  }): Promise<{ id: string }> {
    const res = await this.fetch('/clients', {
      method: 'POST',
      body: JSON.stringify({ enabled: true, publicClient: false, ...data }),
    });
    if (!res.ok) throw await parseKcError(res);

    const location = res.headers.get('location') ?? '';
    const newId = location.split('/').pop() ?? '';
    if (!newId) throw new Error('Client created but ID could not be determined');
    return { id: newId };
  }

  // Partial update of a client rep (PUT merges scalars; arrays/objects are replaced). Used to
  // enable/disable a client (revoke a gateway key = { enabled:false }) without deleting it.
  async updateClient(
    id: string,
    data: Partial<{ enabled: boolean; name: string; description: string; attributes: Record<string, string> }>,
  ): Promise<void> {
    await this.fetchJson<void>(`/clients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteClient(id: string): Promise<void> {
    const res = await this.fetch(`/clients/${id}`, { method: 'DELETE' });
    if (!res.ok) throw await parseKcError(res);
  }

  // The service-account user backing a client (client_credentials). Realm roles
  // assigned to this user become the roles in the client's access token.
  async getServiceAccountUser(internalClientId: string): Promise<KcUser | null> {
    return this.fetchNullable<KcUser>(`/clients/${internalClientId}/service-account-user`);
  }

  // ── Client protocol mappers ─────────────────────────────────────────────────
  // Protocol mappers shape a client's tokens (e.g. an oidc-audience-mapper emits the client's own
  // `aud`). Runtime-created clients get NO mappers by default — they must be attached explicitly, or
  // Keycloak emits only the default aud ("account"). These two calls let provisioning ensure the
  // audience mapper idempotently (list → create-if-absent).

  async listClientProtocolMappers(internalClientId: string): Promise<KcProtocolMapper[]> {
    return this.fetchJson<KcProtocolMapper[]>(`/clients/${internalClientId}/protocol-mappers/models`);
  }

  async createClientProtocolMapper(internalClientId: string, mapper: KcProtocolMapper): Promise<void> {
    // 201 Created with empty body — parseKcBody tolerates it (fetchJson<void>).
    await this.fetchJson<void>(`/clients/${internalClientId}/protocol-mappers/models`, {
      method: 'POST',
      body: JSON.stringify(mapper),
    });
  }

  // Ensure a realm role exists (idempotent) and return it with its id.
  async ensureRealmRole(name: string, description?: string): Promise<KcRole> {
    const existing = (await this.listRealmRoles()).find((r) => r.name === name);
    if (existing) return existing;
    await this.createRealmRole(name, description);
    const created = (await this.listRealmRoles()).find((r) => r.name === name);
    if (!created) throw new Error(`realm role ${name} created but not found`);
    return created;
  }

  async getClientSecret(id: string): Promise<string> {
    const data = await this.fetchJson<{ value: string }>(`/clients/${id}/client-secret`);
    return data.value;
  }

  async regenerateClientSecret(id: string): Promise<string> {
    const data = await this.fetchJson<{ value: string }>(`/clients/${id}/client-secret`, {
      method: 'POST',
    });
    return data.value;
  }

  // ── Realm admin: active sessions ────────────────────────────────────────────
  // Additive — realm-level operational admin. Raw Keycloak JSON is shaped by the pure
  // helpers in keycloak-realm.ts; these methods only do I/O.

  // List a single user's active (online, browser-SSO) sessions.
  // GET /users/{id}/sessions returns UserSessionRepresentation[].
  async listUserSessions(userId: string): Promise<unknown[]> {
    return this.fetchJson<unknown[]>(`/users/${userId}/sessions`);
  }

  // List a user's OFFLINE sessions (refresh-token-backed) across the given internal client ids.
  // Keycloak exposes offline sessions only per-client (GET /users/{id}/offline-sessions/{clientId}),
  // so the caller supplies which clients to check — normally the realm's standard-flow clients, of
  // which there are only a handful. Best-effort: a client with no offline session (or a transient
  // per-client error) contributes nothing; results are flattened. Used alongside the online list so
  // a logged-in operator still renders when the short-lived online session has been reaped by the
  // idle timeout (see mergeUserSessions in keycloak-realm.ts, GAP #36).
  async listUserOfflineSessions(userId: string, internalClientIds: string[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const cid of internalClientIds) {
      try {
        const rows = await this.fetchJson<unknown[]>(`/users/${userId}/offline-sessions/${cid}`);
        if (Array.isArray(rows)) out.push(...rows);
      } catch {
        // A single client's offline-session lookup failing must not sink the whole listing.
      }
    }
    return out;
  }

  // List active sessions for a client (realm-wide sessions are only exposed per-client in Keycloak's
  // admin API). GET /clients/{internalClientId}/user-sessions.
  async listClientSessions(internalClientId: string, first?: number, max?: number): Promise<unknown[]> {
    const params = new URLSearchParams();
    if (first !== undefined) params.set('first', String(first));
    if (max !== undefined) params.set('max', String(max));
    const qs = params.toString() ? `?${params}` : '';
    return this.fetchJson<unknown[]>(`/clients/${internalClientId}/user-sessions${qs}`);
  }

  // Log out every session of a user. POST /users/{id}/logout.
  async logoutUser(userId: string): Promise<void> {
    await this.fetchJson<void>(`/users/${userId}/logout`, { method: 'POST' });
  }

  // Revoke a single session by id. DELETE /admin/realms/{realm}/sessions/{session}.
  async deleteSession(sessionId: string): Promise<void> {
    const res = await this.fetch(`/sessions/${sessionId}`, { method: 'DELETE' });
    if (!res.ok) throw await parseKcError(res);
  }

  // ── Realm admin: MFA / required actions ─────────────────────────────────────

  // The realm's required-action providers. GET /authentication/required-actions.
  async listRequiredActions(): Promise<unknown[]> {
    return this.fetchJson<unknown[]>('/authentication/required-actions');
  }

  // A user's stored credentials (password, otp, webauthn…). GET /users/{id}/credentials.
  async listUserCredentials(userId: string): Promise<unknown[]> {
    return this.fetchJson<unknown[]>(`/users/${userId}/credentials`);
  }

  // Overwrite a user's requiredActions (used to enable/disable "Configure OTP"). The caller merges
  // via the pure helper (withConfigureOtp) and PUTs back only the requiredActions field — Keycloak's
  // user PUT merges scalars but replaces arrays, so we send the full array.
  async setUserRequiredActions(userId: string, requiredActions: string[]): Promise<void> {
    await this.fetchJson<void>(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ requiredActions }),
    });
  }

  // Delete a single credential (e.g. remove a configured OTP device).
  // DELETE /users/{id}/credentials/{credentialId}.
  async deleteUserCredential(userId: string, credentialId: string): Promise<void> {
    const res = await this.fetch(`/users/${userId}/credentials/${credentialId}`, { method: 'DELETE' });
    if (!res.ok) throw await parseKcError(res);
  }

  // ── Realm admin: identity-provider federation ───────────────────────────────

  // List configured IdP instances. GET /identity-provider/instances.
  async listIdentityProviders(): Promise<unknown[]> {
    return this.fetchJson<unknown[]>('/identity-provider/instances');
  }

  // A single IdP instance by alias. GET /identity-provider/instances/{alias}. null on 404 so a stale
  // deep-link renders "not found" instead of a 500.
  async getIdentityProvider(alias: string): Promise<unknown | null> {
    return this.fetchNullable<unknown>(`/identity-provider/instances/${encodeURIComponent(alias)}`);
  }

  // Create an IdP from a prepared representation (built + validated by buildOidcIdpRep/buildSamlIdpRep).
  // POST /identity-provider/instances.
  async createIdentityProvider(rep: unknown): Promise<void> {
    await this.fetchJson<void>('/identity-provider/instances', {
      method: 'POST',
      body: JSON.stringify(rep),
    });
  }

  // Overwrite an IdP instance. PUT /identity-provider/instances/{alias}. CAUTION: Keycloak replaces
  // the whole rep — callers MUST pass a merge of the current rep (mergeIdpUpdate), never a bare patch.
  async updateIdentityProvider(alias: string, rep: unknown): Promise<void> {
    await this.fetchJson<void>(`/identity-provider/instances/${encodeURIComponent(alias)}`, {
      method: 'PUT',
      body: JSON.stringify(rep),
    });
  }

  // Delete an IdP by alias. DELETE /identity-provider/instances/{alias}.
  async deleteIdentityProvider(alias: string): Promise<void> {
    const res = await this.fetch(`/identity-provider/instances/${encodeURIComponent(alias)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw await parseKcError(res);
  }

  // ── Realm admin: token / session lifetimes ──────────────────────────────────

  // The full realm representation. GET /admin/realms/{realm} (the client's baseUrl already includes
  // /admin/realms/{realm}, so an empty path hits the realm root). Returned untyped — the pure helper
  // extractLifetimes() shapes it, and mergeRealmLifetimes() prepares the write.
  async getRealm(): Promise<Record<string, unknown>> {
    return this.fetchJson<Record<string, unknown>>('');
  }

  // Overwrite the realm representation. PUT /admin/realms/{realm}. CAUTION: this replaces the whole
  // rep — callers MUST pass a merge of the current rep (mergeRealmLifetimes), never a bare patch.
  async updateRealm(rep: Record<string, unknown>): Promise<void> {
    await this.fetchJson<void>('', {
      method: 'PUT',
      body: JSON.stringify(rep),
    });
  }
}

// Singleton per process (token is cached in-instance).
let _instance: KeycloakAdminClient | null | undefined;

export function keycloakAdmin(): KeycloakAdminClient | null {
  if (_instance !== undefined) return _instance;

  const url = process.env.OFFGRID_KEYCLOAK_URL;
  const realm = process.env.OFFGRID_KEYCLOAK_REALM;
  const clientId = process.env.OFFGRID_KEYCLOAK_ADMIN_CLIENT_ID;
  const clientSecret = process.env.OFFGRID_KEYCLOAK_ADMIN_CLIENT_SECRET;

  if (!url || !realm || !clientId || !clientSecret) {
    _instance = null;
    return null;
  }

  _instance = new KeycloakAdminClient(url, realm, clientId, clientSecret);
  return _instance;
}
