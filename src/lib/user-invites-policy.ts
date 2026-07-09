// ─── USER INVITE — PURE token / expiry / validation / state logic (zero-IO, unit-tested) ──────────
//
// How a real END-USER (not an admin-token machine) gets onto the platform: an admin or app-creator
// invites a person BY EMAIL; the invite carries an org role and (optionally) an app grant. The person
// clicks an accept link, a Keycloak user is provisioned for them, and their grants apply.
//
// This module owns EVERY decision that needs no DB/network, so the store (user-invites.ts) and the
// routes stay thin and the coverage bar is reachable:
//   • token shape — an opaque single-use secret is generated (impure: randomBytes) then HASHED at rest
//     (sha256, hex) so the plaintext is only ever in the invite email, never in the DB;
//   • email / role / app-grant VALIDATION of an untrusted create payload;
//   • the invite STATE MACHINE — given a stored invite + "now", decide whether it is acceptable, and
//     the resulting status (pending → accepted, or expired / revoked / already-consumed rejections);
//   • the accept-link URL builder + the invite email body.
//
// The org-role vocabulary is the console's own RBAC roles (roles.ts: admin | compliance | viewer) so
// an invited user lands with a real console role. The optional app grant reuses the AppShareRole
// ladder (app-sharing-policy.ts) verbatim — DRY, no second role vocabulary.

import { createHash, randomBytes } from 'node:crypto';
import { RBAC_ROLES, isRbacRole, type RbacRole } from '@/lib/roles';
import {
  type AppShareRole,
  isAppShareRole,
  normalizeShareRole,
  normalizeUserId,
} from '@/lib/app-sharing-policy';

// ─── the org-role a person is invited AT ────────────────────────────────────────────────────────────
// Deliberately the console RBAC roles (roles.ts) — an invite hands the person their console role, which
// then maps to a Keycloak realm role on provisioning. Default is the least-privileged (viewer).
export type InviteOrgRole = RbacRole;
export const INVITE_ORG_ROLES: readonly InviteOrgRole[] = RBAC_ROLES;

/** Coerce an untrusted value to a valid org role, defaulting to viewer (least privilege). PURE. */
export function normalizeOrgRole(v: unknown): InviteOrgRole {
  return isRbacRole(v) ? v : 'viewer';
}

// ─── the optional app grant an invite carries ──────────────────────────────────────────────────────
// An invite MAY land the person with access to a specific app at an app-role (the app-sharing ladder).
// Stored as JSON on the invite row; applied via the app-sharing seam on accept.
export interface InviteAppGrant {
  appId: string;
  appRole: AppShareRole;
}

/** Sanitise an untrusted app_grants array: drop malformed/empty-app entries, dedupe by appId. PURE. */
export function sanitizeAppGrants(raw: unknown): InviteAppGrant[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: InviteAppGrant[] = [];
  for (const g of raw) {
    const o = (g ?? {}) as Record<string, unknown>;
    const appId = typeof o.appId === 'string' ? o.appId.trim() : '';
    if (!appId || seen.has(appId)) continue;
    seen.add(appId);
    out.push({ appId, appRole: normalizeShareRole(o.appRole) });
  }
  return out;
}

// ─── email validation ────────────────────────────────────────────────────────────────────────────
// A pragmatic single-address check (not a full RFC-5322 parser): non-empty local@domain, no spaces,
// one @, a dotted domain. Normalised to trimmed + lower-case (the Keycloak username + the grant id).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalise an email for storage + comparison: trimmed + lower-cased. PURE. */
export function normalizeEmail(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

export function isValidEmail(v: unknown): boolean {
  const e = normalizeEmail(v);
  return e.length <= 320 && EMAIL_RE.test(e);
}

// ─── create-payload validation ──────────────────────────────────────────────────────────────────────
export interface InviteCreateInput {
  email: unknown;
  role?: unknown;
  appGrants?: unknown;
}

export interface InviteCreateValidation {
  ok: boolean;
  errors: string[];
  /** The cleaned, ready-to-persist values (present iff ok). */
  value?: { email: string; role: InviteOrgRole; appGrants: InviteAppGrant[] };
}

/**
 * Validate + normalise an invite create request. PURE. An invalid role/grant is a hard error (we do
 * NOT silently downgrade an admin-typed role on the create path — the admin should see the mistake),
 * whereas an ABSENT role defaults to viewer.
 */
export function validateInviteCreate(input: InviteCreateInput): InviteCreateValidation {
  const errors: string[] = [];
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) errors.push('a valid email address is required');

  let role: InviteOrgRole = 'viewer';
  if (input.role !== undefined && input.role !== null && input.role !== '') {
    if (!isRbacRole(input.role)) {
      errors.push(`role must be one of: ${INVITE_ORG_ROLES.join(', ')}`);
    } else {
      role = input.role;
    }
  }

  // App grants: an explicitly-supplied appRole that isn't a known app-role is an error; a bare appId
  // (no role) defaults to viewer via sanitizeAppGrants. A non-array (when present) is an error.
  let appGrants: InviteAppGrant[] = [];
  if (input.appGrants !== undefined && input.appGrants !== null) {
    if (!Array.isArray(input.appGrants)) {
      errors.push('appGrants must be a list of { appId, appRole }');
    } else {
      for (const g of input.appGrants) {
        const o = (g ?? {}) as Record<string, unknown>;
        if (o.appRole !== undefined && o.appRole !== null && o.appRole !== '' && !isAppShareRole(o.appRole)) {
          errors.push('app grant role must be one of: viewer, runner, approver, editor');
        }
        if (typeof o.appId !== 'string' || !o.appId.trim()) {
          errors.push('each app grant needs an appId');
        }
      }
      appGrants = sanitizeAppGrants(input.appGrants);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], value: { email, role, appGrants } };
}

// ─── token: opaque single-use secret, hashed at rest ────────────────────────────────────────────────
// The plaintext token travels ONLY in the accept-link email. The DB stores its sha256, so a DB leak
// can't be replayed as an accept. Generation is the module's one impure spot (randomBytes); hashing is
// pure + deterministic so the store can look up "does this presented token match a stored hash".
export interface GeneratedToken {
  /** Sent in the email — never persisted. */
  token: string;
  /** Persisted — the sha256 hex of the token. */
  tokenHash: string;
}

/** Generate a fresh opaque token + its at-rest hash. Impure (randomness); the hash step is pure. */
export function generateInviteToken(): GeneratedToken {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

/** sha256-hex of a token. PURE + deterministic — the at-rest form and the lookup key. */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(String(token ?? '')).digest('hex');
}

// ─── expiry ─────────────────────────────────────────────────────────────────────────────────────────
export const DEFAULT_INVITE_TTL_DAYS = 7;

/** The expiry instant for an invite created at `now` with the given TTL. PURE. */
export function inviteExpiryFrom(now: Date, ttlDays: number = DEFAULT_INVITE_TTL_DAYS): Date {
  const days = Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : DEFAULT_INVITE_TTL_DAYS;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

// ─── the invite state machine ─────────────────────────────────────────────────────────────────────
export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export const INVITE_STATUSES: readonly InviteStatus[] = ['pending', 'accepted', 'revoked', 'expired'];

// The minimal slice of a stored invite the acceptance decision needs — no DB row types leaked in.
export interface AcceptableInvite {
  status: InviteStatus;
  expiresAt: Date;
}

export interface AcceptDecision {
  /** true ⇒ this invite may be consumed now. */
  ok: boolean;
  /** The effective status once the clock is applied (a pending-but-past-expiry invite reads 'expired'). */
  effectiveStatus: InviteStatus;
  /** Machine reason for the reject (empty when ok). */
  reason: string;
}

/**
 * Decide whether a stored invite can be accepted at `now`. PURE. The single authority both the accept
 * route and the store's "mark expired" sweep consult, so the rule lives in exactly one place:
 *   • revoked  → rejected;
 *   • accepted → rejected (single-use — a token can't be replayed after consumption);
 *   • pending but past expiry → rejected, and the effective status is 'expired' (so a lazy sweep can
 *     persist the transition);
 *   • pending + unexpired → OK.
 */
export function evaluateAccept(invite: AcceptableInvite, now: Date): AcceptDecision {
  if (invite.status === 'revoked') {
    return { ok: false, effectiveStatus: 'revoked', reason: 'this invite has been revoked' };
  }
  if (invite.status === 'accepted') {
    return { ok: false, effectiveStatus: 'accepted', reason: 'this invite has already been accepted' };
  }
  if (invite.status === 'expired' || now.getTime() >= invite.expiresAt.getTime()) {
    return { ok: false, effectiveStatus: 'expired', reason: 'this invite has expired' };
  }
  return { ok: true, effectiveStatus: 'pending', reason: '' };
}

/** May a PENDING invite be revoked or resent? PURE — only a live (pending, unexpired) invite qualifies. */
export function canRevoke(invite: AcceptableInvite, now: Date): boolean {
  return evaluateAccept(invite, now).ok;
}

// ─── the accept-link URL ──────────────────────────────────────────────────────────────────────────
/**
 * Build the accept link the invite email carries. PURE. `baseUrl` is the console origin
 * (scheme+host, no trailing slash required); the token is URL-encoded. e.g.
 *   https://acme-onprem-console.getoffgridai.co/invite/accept?token=abc123
 */
export function buildAcceptUrl(baseUrl: string, token: string): string {
  const origin = String(baseUrl ?? '').replace(/\/+$/, '');
  return `${origin}/invite/accept?token=${encodeURIComponent(token)}`;
}

/**
 * Resolve the console's public origin (scheme://host) from request headers, honoring the Cloudflare /
 * proxy forwarded headers the deployment sits behind. PURE. Falls back to the OFFGRID_CONSOLE_URL env
 * origin, then a localhost default. Used to build the accept link so it points at the tenant's own host.
 */
export function baseUrlFromHeaders(
  get: (name: string) => string | null,
  envOrigin?: string,
): string {
  const host = get('x-forwarded-host') ?? get('host');
  if (host && host.trim()) {
    const proto = (get('x-forwarded-proto') ?? '').trim() || (host.includes('localhost') ? 'http' : 'https');
    return `${proto}://${host.trim()}`;
  }
  const env = (envOrigin ?? '').trim().replace(/\/+$/, '');
  return env || 'http://localhost:3000';
}

// ─── the invite EMAIL body (brand voice) ────────────────────────────────────────────────────────────
// PURE text/subject builder — reused by the send route and unit-tested. Brand rule: it's "Off Grid AI",
// outcome-led, speaks to "you". No OSS engine names, no internal mechanism.
export interface InviteEmailInput {
  orgName: string;
  acceptUrl: string;
  invitedByName?: string;
  /** ISO / display date the link stops working. */
  expiresAtDisplay: string;
}

export interface InviteEmail {
  subject: string;
  text: string;
}

export function buildInviteEmail(input: InviteEmailInput): InviteEmail {
  const org = (input.orgName ?? '').trim() || 'your team';
  const by = (input.invitedByName ?? '').trim();
  const subject = `You've been invited to ${org} on Off Grid AI`;
  const opener = by
    ? `${by} has invited you to join ${org} on Off Grid AI.`
    : `You've been invited to join ${org} on Off Grid AI.`;
  const text = [
    opener,
    '',
    "Off Grid AI is your private AI, everywhere — your data stays on your organisation's own systems.",
    '',
    'Accept your invitation and set up your account:',
    input.acceptUrl,
    '',
    `This link is valid until ${input.expiresAtDisplay}. If it expires, ask whoever invited you to send a fresh one.`,
    '',
    "If you weren't expecting this, you can safely ignore this email.",
  ].join('\n');
  return { subject, text };
}

// ─── Keycloak provisioning shape (PURE) ─────────────────────────────────────────────────────────────
// The exact required-actions we set on a freshly-provisioned invitee so KEYCLOAK owns the credential:
// the user has NO password until they complete UPDATE_PASSWORD, and VERIFY_EMAIL confirms the address.
// The set-password/verify flow runs in Keycloak on first sign-in — the console never handles the
// plaintext password. Kept here as a pure constant so the store + tests share one definition.
export const INVITE_REQUIRED_ACTIONS: readonly string[] = ['UPDATE_PASSWORD', 'VERIFY_EMAIL'];

/** Map a console org-role to the Keycloak realm role name to assign. PURE. (1:1 today; a seam for later.) */
export function keycloakRealmRoleForOrgRole(role: InviteOrgRole): string {
  return role;
}

/** Re-export for the store so callers have one import surface. */
export { normalizeUserId };
