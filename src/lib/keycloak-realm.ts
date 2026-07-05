// Pure request/response shaping for Keycloak realm-level admin — sessions, MFA/required-actions,
// identity-provider federation, and token/session lifetimes. Zero I/O, zero imports: every function
// takes representative Keycloak JSON and returns a normalized view (or, for edits, the merged payload
// to PUT back). This is the unit-testable core; `keycloak-admin.ts` is the thin network adapter and
// the routes are thin over that. Keeps realm-admin logic isolated from fetch() so it can be exercised
// with real Keycloak JSON and no network mocks.

// ── Active sessions ───────────────────────────────────────────────────────────

// A Keycloak user session as returned by GET /users/{id}/sessions or
// GET /clients/{id}/user-sessions. Only the fields we surface are typed; Keycloak sends more.
export interface KcRawSession {
  id: string;
  username?: string;
  userId?: string;
  ipAddress?: string;
  start?: number; // ms epoch
  lastAccess?: number; // ms epoch
  clients?: Record<string, string>; // internalClientId -> clientId
}

export interface KcSession {
  id: string;
  username: string;
  userId?: string;
  ipAddress: string;
  start: number;
  lastAccess: number;
  clients: string[]; // human clientIds the session has tokens for
}

// Normalize a raw Keycloak session into the shape the console renders. Tolerates missing fields
// (Keycloak omits ipAddress for some flows; clients may be absent).
export function normalizeSession(raw: KcRawSession): KcSession {
  return {
    id: raw.id,
    username: raw.username ?? '',
    userId: raw.userId,
    ipAddress: raw.ipAddress ?? '',
    start: raw.start ?? 0,
    lastAccess: raw.lastAccess ?? 0,
    clients: raw.clients ? Object.values(raw.clients) : [],
  };
}

// Normalize + sort a list of sessions, most-recently-active first.
export function normalizeSessions(raw: KcRawSession[]): KcSession[] {
  return raw.map(normalizeSession).sort((a, b) => b.lastAccess - a.lastAccess);
}

// ── MFA / required actions ──────────────────────────────────────────────────────

// A realm required-action provider (GET /admin/realms/{realm}/authentication/required-actions).
export interface KcRawRequiredAction {
  alias: string;
  name?: string;
  enabled?: boolean;
  defaultAction?: boolean;
}

export interface KcRequiredAction {
  alias: string;
  name: string;
  enabled: boolean;
  defaultAction: boolean;
}

export function normalizeRequiredAction(raw: KcRawRequiredAction): KcRequiredAction {
  return {
    alias: raw.alias,
    name: raw.name ?? raw.alias,
    enabled: raw.enabled ?? false,
    defaultAction: raw.defaultAction ?? false,
  };
}

export function normalizeRequiredActions(raw: KcRawRequiredAction[]): KcRequiredAction[] {
  return raw.map(normalizeRequiredAction);
}

// A user credential (GET /users/{id}/credentials). We only care about type to derive OTP status.
export interface KcRawCredential {
  id: string;
  type: string;
  userLabel?: string;
  createdDate?: number;
}

export interface KcMfaStatus {
  otpConfigured: boolean;
  credentials: { id: string; type: string; label: string; createdDate?: number }[];
}

// Derive a user's MFA status from their credential list. OTP is configured iff a credential of
// type "otp" exists. "password" and "webauthn"/"webauthn-passwordless" are surfaced too.
export function deriveMfaStatus(creds: KcRawCredential[]): KcMfaStatus {
  return {
    otpConfigured: creds.some((c) => c.type === 'otp'),
    credentials: creds.map((c) => ({
      id: c.id,
      type: c.type,
      label: c.userLabel ?? c.type,
      createdDate: c.createdDate,
    })),
  };
}

// Build the requiredActions array to PUT on a user to enable "Configure OTP". Merges with any
// existing required actions (idempotent — never duplicates CONFIGURE_TOTP), preserving the rest.
export function withConfigureOtp(existing: string[] | undefined): string[] {
  const set = new Set(existing ?? []);
  set.add('CONFIGURE_TOTP');
  return [...set];
}

// Build the requiredActions array with "Configure OTP" removed (undo the enablement).
export function withoutConfigureOtp(existing: string[] | undefined): string[] {
  return (existing ?? []).filter((a) => a !== 'CONFIGURE_TOTP');
}

// ── Identity-provider federation ─────────────────────────────────────────────────

// An IdP instance (GET /admin/realms/{realm}/identity-provider/instances).
export interface KcRawIdp {
  alias: string;
  displayName?: string;
  providerId?: string; // "oidc" | "saml" | "google" | ...
  enabled?: boolean;
  config?: Record<string, string>;
}

export interface KcIdp {
  alias: string;
  displayName: string;
  providerId: string;
  enabled: boolean;
  // A couple of the most operationally-useful config keys, surfaced read-only.
  authorizationUrl?: string;
  tokenUrl?: string;
  clientId?: string;
}

export function normalizeIdp(raw: KcRawIdp): KcIdp {
  const cfg = raw.config ?? {};
  return {
    alias: raw.alias,
    displayName: raw.displayName || raw.alias,
    providerId: raw.providerId ?? 'oidc',
    enabled: raw.enabled ?? false,
    authorizationUrl: cfg.authorizationUrl,
    tokenUrl: cfg.tokenUrl,
    clientId: cfg.clientId,
  };
}

export function normalizeIdps(raw: KcRawIdp[]): KcIdp[] {
  return raw.map(normalizeIdp).sort((a, b) => a.alias.localeCompare(b.alias));
}

export interface CreateOidcIdpInput {
  alias: string;
  displayName?: string;
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

// Validate + build the IdP representation to POST for an OIDC provider. Keycloak's IdP create is
// config-heavy; we support the common OIDC case (authorization-code flow) and leave SAML / advanced
// mappers to the Keycloak admin console. Returns { error } on invalid input so the route stays thin.
export function buildOidcIdpRep(
  input: CreateOidcIdpInput,
): { rep: KcRawIdp } | { error: string } {
  const alias = input.alias?.trim();
  if (!alias) return { error: 'alias is required' };
  if (!/^[a-z0-9_-]+$/i.test(alias)) {
    return { error: 'alias may only contain letters, numbers, hyphen and underscore' };
  }
  if (!input.authorizationUrl?.trim()) return { error: 'authorizationUrl is required' };
  if (!input.tokenUrl?.trim()) return { error: 'tokenUrl is required' };
  if (!input.clientId?.trim()) return { error: 'clientId is required' };
  if (!input.clientSecret?.trim()) return { error: 'clientSecret is required' };

  return {
    rep: {
      alias,
      displayName: input.displayName?.trim() || alias,
      providerId: 'oidc',
      enabled: true,
      config: {
        authorizationUrl: input.authorizationUrl.trim(),
        tokenUrl: input.tokenUrl.trim(),
        clientId: input.clientId.trim(),
        clientSecret: input.clientSecret.trim(),
        clientAuthMethod: 'client_secret_post',
        syncMode: 'IMPORT',
        useJwksUrl: 'true',
      },
    },
  };
}

// ── Token / session lifetimes ────────────────────────────────────────────────────

// The subset of the realm representation (GET /admin/realms/{realm}) we surface + edit. Keycloak's
// realm rep is huge; these are the lifetime knobs operators actually tune. All values are SECONDS.
export interface KcRealmLifetimes {
  realm: string;
  accessTokenLifespan?: number;
  ssoSessionIdleTimeout?: number;
  ssoSessionMaxLifespan?: number;
  accessTokenLifespanForImplicitFlow?: number;
  offlineSessionIdleTimeout?: number;
  actionTokenGeneratedByUserLifespan?: number;
}

const LIFETIME_KEYS = [
  'accessTokenLifespan',
  'ssoSessionIdleTimeout',
  'ssoSessionMaxLifespan',
  'accessTokenLifespanForImplicitFlow',
  'offlineSessionIdleTimeout',
  'actionTokenGeneratedByUserLifespan',
] as const;

export type LifetimeKey = (typeof LIFETIME_KEYS)[number];

export function lifetimeKeys(): readonly LifetimeKey[] {
  return LIFETIME_KEYS;
}

// Pull the lifetime fields out of a full realm representation for display.
export function extractLifetimes(realm: Record<string, unknown>): KcRealmLifetimes {
  const out: KcRealmLifetimes = { realm: String(realm.realm ?? '') };
  for (const key of LIFETIME_KEYS) {
    const v = realm[key];
    if (typeof v === 'number') out[key] = v;
  }
  return out;
}

// Validate a lifetimes patch. Values must be non-negative integers (seconds). Returns the cleaned
// patch (only known keys, only provided values) or an error string.
export function validateLifetimesPatch(
  patch: Record<string, unknown>,
): { patch: Partial<Record<LifetimeKey, number>> } | { error: string } {
  const clean: Partial<Record<LifetimeKey, number>> = {};
  for (const key of LIFETIME_KEYS) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      return { error: `${key} must be a non-negative integer (seconds)` };
    }
    clean[key] = v;
  }
  if (Object.keys(clean).length === 0) {
    return { error: 'no valid lifetime fields to update' };
  }
  return { patch: clean };
}

// CRITICAL: merge, don't clobber. Keycloak's PUT /admin/realms/{realm} replaces the whole realm rep,
// so we must send the FULL current rep with only the lifetime fields overwritten — anything dropped
// gets reset to defaults. This takes the current full rep + a validated patch and returns the body
// to PUT.
export function mergeRealmLifetimes(
  current: Record<string, unknown>,
  patch: Partial<Record<LifetimeKey, number>>,
): Record<string, unknown> {
  return { ...current, ...patch };
}

// Human-friendly seconds → "1h 30m" style, for the UI. Pure so it's testable.
export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || seconds < 0) return '—';
  if (seconds === 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);
  return parts.join(' ');
}
