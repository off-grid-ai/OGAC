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
}

interface TokenCache {
  accessToken: string;
  expiresAt: number; // ms epoch
}

// Error carrying the upstream Keycloak HTTP status so routes can map it to the right response.
export class KeycloakError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'KeycloakError';
  }
}

async function parseKcError(res: Response): Promise<Error> {
  // 409 on create = the clientId/username already exists. Keycloak's 409 body is usually empty,
  // so synthesize a human message instead of a bare "HTTP 409".
  if (res.status === 409) {
    return new KeycloakError('Already exists — pick a different ID (that one is taken).', 409);
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
    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
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

  async deleteClient(id: string): Promise<void> {
    const res = await this.fetch(`/clients/${id}`, { method: 'DELETE' });
    if (!res.ok) throw await parseKcError(res);
  }

  // The service-account user backing a client (client_credentials). Realm roles
  // assigned to this user become the roles in the client's access token.
  async getServiceAccountUser(internalClientId: string): Promise<KcUser | null> {
    return this.fetchNullable<KcUser>(`/clients/${internalClientId}/service-account-user`);
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
