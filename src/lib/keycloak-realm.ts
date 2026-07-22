// Pure request/response shaping for Keycloak realm-level admin — sessions, MFA/required-actions,
// identity-provider federation, and token/session lifetimes. Zero I/O; the ONLY import is the
// pure, zero-IO display-host mapper (so a rendered session IP is never a raw 127.0.0.1 / LAN
// address). Every function takes representative Keycloak JSON and returns a normalized view (or,
// for edits, the merged payload to PUT back). This is the unit-testable core; `keycloak-admin.ts`
// is the thin network adapter and the routes are thin over that. Keeps realm-admin logic isolated
// from fetch() so it can be exercised with real Keycloak JSON and no network mocks.

import { toDisplayHost } from './display-host';

// ── Error shaping (actionable admin-grant messages) ───────────────────────────────

// The realm-management client role each realm-admin operation requires. Keycloak returns a bare 403
// (empty body) when the console's admin service-account is authenticated but lacks the role, so we
// map the failing operation to the exact role the operator must grant — no more raw "HTTP 403".
export type KcAdminOp =
  | 'list-identity-providers'
  | 'manage-identity-providers'
  | 'view-users'
  | 'manage-users';

const OP_ROLE: Record<KcAdminOp, string> = {
  'list-identity-providers': 'view-identity-providers',
  'manage-identity-providers': 'manage-identity-providers',
  'view-users': 'view-users',
  'manage-users': 'manage-users',
};

// Turn a Keycloak error into a user-facing message. On a 403 for a known operation, name the exact
// missing `realm-management` role and that it's granted on the console's admin service-account —
// so the message tells the operator precisely what to fix (GAP #37). Any non-403 (or an unknown op)
// passes the original message through unchanged. Pure — unit-testable, zero-IO.
export function forbiddenGrantMessage(op: KcAdminOp, status: number, fallback: string): string {
  if (status !== 403) return fallback;
  const role = OP_ROLE[op];
  return (
    `Keycloak denied this request (403). The console's admin service-account is missing the ` +
    `realm-management role "${role}". Grant it to the account (client ` +
    `OFFGRID_KEYCLOAK_ADMIN_CLIENT_ID) on realm-management, then retry.`
  );
}

// ── Federation self-heal (GAP #40) ───────────────────────────────────────────────
// The console's own admin service-account needs these `realm-management` CLIENT roles to read + write
// identity-provider federation. On a fresh realm they are unassigned, so the first federation call
// 403s. The provision route grants exactly these to the SA — a one-click self-heal instead of a
// manual bootstrap. The name of the client whose roles these are, and the SA username derivation, are
// pure so they're unit-testable without a Keycloak.

// The Keycloak client that owns the fine-grained realm-admin roles.
export const REALM_MANAGEMENT_CLIENT = 'realm-management';

// The realm-management client roles federation read+write require. Kept in sync with OP_ROLE above
// (the two federation ops). Returned as a fresh array so a caller can't mutate the source of truth.
export function federationGrantRoleNames(): string[] {
  return [OP_ROLE['list-identity-providers'], OP_ROLE['manage-identity-providers']];
}

// Keycloak names a client's service-account user `service-account-<clientId>` (lower-cased). This is
// the user we assign the realm-management roles to — derive it purely from the admin client id.
export function serviceAccountUsername(clientId: string): string {
  return `service-account-${clientId.trim().toLowerCase()}`;
}

// The exact kcadm command an operator can run by hand if the console's own SA lacks the rights to
// self-grant (it needs manage-users + view/manage-clients on realm-management to grant to itself).
// Surfaced in the provision route's failure body so the fallback is copy-pasteable, never a bare 403.
export function federationGrantCommand(clientId: string): string {
  const roles = federationGrantRoleNames().join(' --rolename ');
  return (
    `kcadm.sh add-roles -r <realm> --uusername ${serviceAccountUsername(clientId)} ` +
    `--cclientid ${REALM_MANAGEMENT_CLIENT} --rolename ${roles}`
  );
}

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
  offline: boolean; // true for an offline (refresh-backed) session, false for an online SSO session
}

// Normalize a raw Keycloak session into the shape the console renders. Tolerates missing fields
// (Keycloak omits ipAddress for some flows; clients may be absent). The IP is passed through
// toDisplayHost so a loopback/LAN address surfaces as its mDNS host — never a raw 127.0.0.1 (the
// console reaches Keycloak over loopback, so a same-host browser login records 127.0.0.1).
export function normalizeSession(raw: KcRawSession, offline = false): KcSession {
  const ip = raw.ipAddress ?? '';
  return {
    id: raw.id,
    username: raw.username ?? '',
    userId: raw.userId,
    ipAddress: ip ? toDisplayHost(ip) : '',
    start: raw.start ?? 0,
    lastAccess: raw.lastAccess ?? 0,
    clients: raw.clients ? Object.values(raw.clients) : [],
    offline,
  };
}

// Normalize + sort a list of sessions, most-recently-active first.
export function normalizeSessions(raw: KcRawSession[], offline = false): KcSession[] {
  return raw.map((r) => normalizeSession(r, offline)).sort((a, b) => b.lastAccess - a.lastAccess);
}

// Merge a user's ONLINE (browser-SSO) and OFFLINE (refresh-token-backed) sessions into one list,
// de-duplicated by session id (Keycloak can list the same session under both), sorted most-recent
// first. Why both: the console signs users in via Direct-Access-Grant (ROPC), whose short-lived
// access token leaves only a fleeting online session that an idle timeout reaps — so a genuinely
// logged-in operator often has NO online session but may still have an offline one. Listing both
// is what makes an active login actually render (GAP #36).
export function mergeUserSessions(
  online: KcRawSession[],
  offline: KcRawSession[],
): KcSession[] {
  const byId = new Map<string, KcSession>();
  for (const s of normalizeSessions(online, false)) byId.set(s.id, s);
  // Offline sessions only fill gaps — an online session for the same id wins (it's the live one).
  for (const s of normalizeSessions(offline, true)) if (!byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => b.lastAccess - a.lastAccess);
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

// The user required-actions the console lets an operator toggle. Keycloak defines these built-in
// action aliases; we surface a curated, human-labelled subset (the ones a BFSI access admin actually
// sets on a person: prove the email, rotate the password, set up 2FA, complete the profile). The
// catalog is the single source of truth for both validation (only a known action may be set) and the
// UI labels — no drift between the route and the panel.
export interface RequiredActionSpec {
  alias: string;
  label: string;
  help: string;
}

export const KNOWN_REQUIRED_ACTIONS: readonly RequiredActionSpec[] = [
  {
    alias: 'VERIFY_EMAIL',
    label: 'Verify email',
    help: 'User must confirm their email address on next login.',
  },
  {
    alias: 'UPDATE_PASSWORD',
    label: 'Update password',
    help: 'User must set a new password on next login.',
  },
  {
    alias: 'CONFIGURE_TOTP',
    label: 'Configure OTP (2FA)',
    help: 'User must set up a one-time-password authenticator on next login.',
  },
  {
    alias: 'UPDATE_PROFILE',
    label: 'Update profile',
    help: 'User must review and complete their profile on next login.',
  },
] as const;

// Is `alias` one the console is allowed to toggle? Guards the route against arbitrary writes.
export function isKnownRequiredAction(alias: string): boolean {
  return KNOWN_REQUIRED_ACTIONS.some((a) => a.alias === alias);
}

// Build the requiredActions array to PUT on a user with `action` ENABLED. Merges with any existing
// required actions (idempotent — never duplicates), preserving the rest.
export function withRequiredAction(existing: string[] | undefined, action: string): string[] {
  const set = new Set(existing ?? []);
  set.add(action);
  return [...set];
}

// Build the requiredActions array with `action` REMOVED (undo the enablement), preserving the rest.
export function withoutRequiredAction(existing: string[] | undefined, action: string): string[] {
  return (existing ?? []).filter((a) => a !== action);
}

// Back-compat wrappers for the OTP-specific MFA route (delegate to the generic helpers — DRY).
export function withConfigureOtp(existing: string[] | undefined): string[] {
  return withRequiredAction(existing, 'CONFIGURE_TOTP');
}

export function withoutConfigureOtp(existing: string[] | undefined): string[] {
  return withoutRequiredAction(existing, 'CONFIGURE_TOTP');
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

// Config keys whose values are secrets — never surfaced to the client. The detail view shows a
// placeholder ("configured") instead of the value, and an update leaves them untouched unless a new
// value is explicitly supplied (see mergeIdpUpdate). Single source of truth so the detail normalizer
// and the update-merge agree on what's sensitive.
export const IDP_SECRET_CONFIG_KEYS: readonly string[] = ['clientSecret'] as const;

export function isIdpSecretConfigKey(key: string): boolean {
  return IDP_SECRET_CONFIG_KEYS.includes(key);
}

// The full IdP view for the DETAIL page — everything normalizeIdp surfaces PLUS the complete config
// map with secret values redacted (so the raw clientSecret never crosses the wire). `secretKeysConfigured`
// flags which keys are configured-but-hidden, so the edit form can show "leave blank to keep" affordances.
export interface KcIdpDetail extends KcIdp {
  config: Record<string, string>; // secret values replaced with ''
  secretKeysConfigured: string[]; // secret keys that currently hold a non-empty value
}

export function normalizeIdpDetail(raw: KcRawIdp): KcIdpDetail {
  const base = normalizeIdp(raw);
  const rawConfig = raw.config ?? {};
  const config: Record<string, string> = {};
  const secretKeysConfigured: string[] = [];
  for (const [key, value] of Object.entries(rawConfig)) {
    if (isIdpSecretConfigKey(key)) {
      if (value) secretKeysConfigured.push(key);
      config[key] = ''; // redact — never echo a secret back
    } else {
      config[key] = value;
    }
  }
  return { ...base, config, secretKeysConfigured };
}

// Validate an IdP alias (shared by OIDC + SAML builders — DRY). Returns an error string or null.
export function validateIdpAlias(alias: string | undefined): string | null {
  const trimmed = alias?.trim();
  if (!trimmed) return 'alias is required';
  if (!/^[a-z0-9_-]+$/i.test(trimmed)) {
    return 'alias may only contain letters, numbers, hyphen and underscore';
  }
  return null;
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
// config-heavy; we support the common OIDC case (authorization-code flow). Returns { error } on
// invalid input so the route stays thin.
export function buildOidcIdpRep(
  input: CreateOidcIdpInput,
): { rep: KcRawIdp } | { error: string } {
  const aliasError = validateIdpAlias(input.alias);
  if (aliasError) return { error: aliasError };
  const alias = input.alias.trim();
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

export interface CreateSamlIdpInput {
  alias: string;
  displayName?: string;
  singleSignOnServiceUrl: string;
  entityId?: string; // this SP/realm's entity id sent to the IdP (optional)
  singleLogoutServiceUrl?: string;
}

// Validate + build the IdP representation to POST for a SAML v2 provider (POST-binding, persistent
// NameID — the common enterprise SSO case). Keycloak's SAML config is large; we set the operationally
// essential keys and leave signing-cert/advanced-mapper tuning to the identity provider's own console.
// Returns { error } on invalid input.
export function buildSamlIdpRep(
  input: CreateSamlIdpInput,
): { rep: KcRawIdp } | { error: string } {
  const aliasError = validateIdpAlias(input.alias);
  if (aliasError) return { error: aliasError };
  const alias = input.alias.trim();
  if (!input.singleSignOnServiceUrl?.trim()) return { error: 'singleSignOnServiceUrl is required' };

  const config: Record<string, string> = {
    singleSignOnServiceUrl: input.singleSignOnServiceUrl.trim(),
    nameIDPolicyFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
    postBindingResponse: 'true',
    postBindingAuthnRequest: 'true',
    postBindingLogout: 'true',
    wantAuthnRequestsSigned: 'false',
    syncMode: 'IMPORT',
  };
  if (input.entityId?.trim()) config.entityId = input.entityId.trim();
  if (input.singleLogoutServiceUrl?.trim()) {
    config.singleLogoutServiceUrl = input.singleLogoutServiceUrl.trim();
  }

  return {
    rep: {
      alias,
      displayName: input.displayName?.trim() || alias,
      providerId: 'saml',
      enabled: true,
      config,
    },
  };
}

export interface IdpUpdatePatch {
  enabled?: boolean;
  displayName?: string;
  config?: Record<string, string>;
}

// CRITICAL: merge, don't clobber. Keycloak's PUT /identity-provider/instances/{alias} replaces the
// WHOLE rep, so we take the current full raw rep and overwrite only the fields the operator changed.
// Secret config keys (clientSecret) are left untouched when the patch omits them or sends an empty
// value — so editing a display name never wipes the stored secret, and the redacted '' the detail
// view sends back is ignored rather than persisted as an empty secret. `alias` and `providerId` are
// immutable (Keycloak keys the instance on alias). Pure — unit-testable, zero-IO.
export function mergeIdpUpdate(current: KcRawIdp, patch: IdpUpdatePatch): KcRawIdp {
  const merged: KcRawIdp = { ...current };
  if (typeof patch.enabled === 'boolean') merged.enabled = patch.enabled;
  if (patch.displayName !== undefined && patch.displayName.trim() !== '') {
    merged.displayName = patch.displayName.trim();
  }
  if (patch.config) {
    const nextConfig: Record<string, string> = { ...(current.config ?? {}) };
    for (const [key, value] of Object.entries(patch.config)) {
      // A redacted/blank secret means "keep the stored one" — never overwrite with empty.
      if (isIdpSecretConfigKey(key) && value.trim() === '') continue;
      nextConfig[key] = value;
    }
    merged.config = nextConfig;
  }
  return merged;
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
