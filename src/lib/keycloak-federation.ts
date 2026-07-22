// Pure request/response shaping for Keycloak enterprise ACCESS depth — realm-wide MFA / OTP policy
// and identity-provider FEDERATION rollups. Zero I/O, zero framework imports: every function takes
// representative Keycloak JSON (or a raw patch) and returns a normalized view — or, for edits, the
// full realm rep to PUT back. This is the unit-testable core; the route handlers are the thin network
// adapter over `keycloakAdmin()` (the KeycloakAdminClient is itself the I/O adapter — see
// keycloak-admin.ts).
//
// Why this file (vs keycloak-realm.ts): keycloak-realm.ts owns the PROVEN identity-lifecycle shaping
// (sessions, per-user required-actions, IdP create/merge, token lifetimes). This file adds the NEW
// realm-level MFA-policy surface — the realm's `otpPolicy*` knobs a BFSI access admin tunes to ENFORCE
// strong 2FA (TOTP vs HOTP, hash algorithm, digit count, time window) — plus a couple of pure
// federation-overview rollups. Kept separate so the new capability never touches the proven paths.

// ── OTP / MFA policy (realm-level) ────────────────────────────────────────────────
// The realm representation (GET /admin/realms/{realm}) carries the whole realm's OTP policy. These
// are the knobs that decide how strong every user's authenticator must be. All live on the realm rep
// and are written back via PUT /admin/realms/{realm} (Keycloak replaces the WHOLE rep — so an edit
// MUST merge onto the current rep, never send a bare patch; see mergeOtpPolicy).

export type OtpPolicyType = 'totp' | 'hotp';
export type OtpPolicyAlgorithm = 'HmacSHA1' | 'HmacSHA256' | 'HmacSHA512';
export type OtpPolicyDigits = 6 | 8;

export const OTP_POLICY_TYPES: readonly OtpPolicyType[] = ['totp', 'hotp'] as const;
export const OTP_POLICY_ALGORITHMS: readonly OtpPolicyAlgorithm[] = [
  'HmacSHA1',
  'HmacSHA256',
  'HmacSHA512',
] as const;
export const OTP_POLICY_DIGITS: readonly OtpPolicyDigits[] = [6, 8] as const;

// The realm OTP policy the console surfaces + edits. Mirrors the Keycloak realm-rep field names so
// merge is a straight key copy. `period` matters for TOTP (time step, seconds); `initialCounter`
// matters for HOTP (event counter start). `lookAheadWindow` is how many steps ahead Keycloak will
// accept (clock/counter drift tolerance). `codeReusable` allows re-use of an already-used code within
// its window (weaker — default false).
export interface KcOtpPolicy {
  type: OtpPolicyType;
  algorithm: OtpPolicyAlgorithm;
  digits: OtpPolicyDigits;
  period: number; // seconds (TOTP)
  initialCounter: number; // HOTP
  lookAheadWindow: number;
  codeReusable: boolean;
}

// Keycloak's built-in defaults (a fresh realm reports these). Used as the fallback when a field is
// absent from the realm rep so the panel always renders a concrete, honest value.
export const DEFAULT_OTP_POLICY: KcOtpPolicy = {
  type: 'totp',
  algorithm: 'HmacSHA1',
  digits: 6,
  period: 30,
  initialCounter: 0,
  lookAheadWindow: 1,
  codeReusable: false,
};

function asOtpType(v: unknown): OtpPolicyType {
  return v === 'hotp' ? 'hotp' : 'totp';
}

function asOtpAlgorithm(v: unknown): OtpPolicyAlgorithm {
  return v === 'HmacSHA256' || v === 'HmacSHA512' ? v : 'HmacSHA1';
}

function asOtpDigits(v: unknown): OtpPolicyDigits {
  return v === 8 ? 8 : 6;
}

// Pull the OTP policy out of a full realm representation for display. Tolerates any field being
// absent (a minimally-seeded realm) by falling back to the Keycloak default for that field. Pure.
export function extractOtpPolicy(realm: Record<string, unknown>): KcOtpPolicy {
  const type = asOtpType(realm.otpPolicyType);
  const algorithm = asOtpAlgorithm(realm.otpPolicyAlgorithm);
  const digits = asOtpDigits(realm.otpPolicyDigits);
  const period =
    typeof realm.otpPolicyPeriod === 'number' ? realm.otpPolicyPeriod : DEFAULT_OTP_POLICY.period;
  const initialCounter =
    typeof realm.otpPolicyInitialCounter === 'number'
      ? realm.otpPolicyInitialCounter
      : DEFAULT_OTP_POLICY.initialCounter;
  const lookAheadWindow =
    typeof realm.otpPolicyLookAheadWindow === 'number'
      ? realm.otpPolicyLookAheadWindow
      : DEFAULT_OTP_POLICY.lookAheadWindow;
  const codeReusable =
    typeof realm.otpPolicyCodeReusable === 'boolean'
      ? realm.otpPolicyCodeReusable
      : DEFAULT_OTP_POLICY.codeReusable;
  return { type, algorithm, digits, period, initialCounter, lookAheadWindow, codeReusable };
}

export interface OtpPolicyPatch {
  type?: OtpPolicyType;
  algorithm?: OtpPolicyAlgorithm;
  digits?: OtpPolicyDigits;
  period?: number;
  initialCounter?: number;
  lookAheadWindow?: number;
  codeReusable?: boolean;
}

// Validate an incoming OTP-policy patch. Enums must be one of the known values; numeric windows must
// be positive integers (a zero period/window would break authenticator validation). `initialCounter`
// may be zero (a valid HOTP start). Returns the cleaned patch (only known, provided fields) or an
// error string. Pure — the single source of truth the route trusts.
export function validateOtpPolicyPatch(
  patch: Record<string, unknown>,
): { patch: OtpPolicyPatch } | { error: string } {
  const clean: OtpPolicyPatch = {};

  if ('type' in patch && patch.type !== undefined) {
    if (!OTP_POLICY_TYPES.includes(patch.type as OtpPolicyType)) {
      return { error: `type must be one of: ${OTP_POLICY_TYPES.join(', ')}` };
    }
    clean.type = patch.type as OtpPolicyType;
  }

  if ('algorithm' in patch && patch.algorithm !== undefined) {
    if (!OTP_POLICY_ALGORITHMS.includes(patch.algorithm as OtpPolicyAlgorithm)) {
      return { error: `algorithm must be one of: ${OTP_POLICY_ALGORITHMS.join(', ')}` };
    }
    clean.algorithm = patch.algorithm as OtpPolicyAlgorithm;
  }

  if ('digits' in patch && patch.digits !== undefined) {
    if (!OTP_POLICY_DIGITS.includes(patch.digits as OtpPolicyDigits)) {
      return { error: `digits must be one of: ${OTP_POLICY_DIGITS.join(', ')}` };
    }
    clean.digits = patch.digits as OtpPolicyDigits;
  }

  if ('period' in patch && patch.period !== undefined) {
    if (!Number.isInteger(patch.period) || (patch.period as number) < 1) {
      return { error: 'period must be a positive integer (seconds)' };
    }
    clean.period = patch.period as number;
  }

  if ('initialCounter' in patch && patch.initialCounter !== undefined) {
    if (!Number.isInteger(patch.initialCounter) || (patch.initialCounter as number) < 0) {
      return { error: 'initialCounter must be a non-negative integer' };
    }
    clean.initialCounter = patch.initialCounter as number;
  }

  if ('lookAheadWindow' in patch && patch.lookAheadWindow !== undefined) {
    if (!Number.isInteger(patch.lookAheadWindow) || (patch.lookAheadWindow as number) < 1) {
      return { error: 'lookAheadWindow must be a positive integer' };
    }
    clean.lookAheadWindow = patch.lookAheadWindow as number;
  }

  if ('codeReusable' in patch && patch.codeReusable !== undefined) {
    if (typeof patch.codeReusable !== 'boolean') {
      return { error: 'codeReusable must be a boolean' };
    }
    clean.codeReusable = patch.codeReusable;
  }

  if (Object.keys(clean).length === 0) {
    return { error: 'no valid OTP policy fields to update' };
  }
  return { patch: clean };
}

// Map the validated patch onto the Keycloak realm-rep field names.
function otpPatchToRealmFields(patch: OtpPolicyPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.type !== undefined) out.otpPolicyType = patch.type;
  if (patch.algorithm !== undefined) out.otpPolicyAlgorithm = patch.algorithm;
  if (patch.digits !== undefined) out.otpPolicyDigits = patch.digits;
  if (patch.period !== undefined) out.otpPolicyPeriod = patch.period;
  if (patch.initialCounter !== undefined) out.otpPolicyInitialCounter = patch.initialCounter;
  if (patch.lookAheadWindow !== undefined) out.otpPolicyLookAheadWindow = patch.lookAheadWindow;
  if (patch.codeReusable !== undefined) out.otpPolicyCodeReusable = patch.codeReusable;
  return out;
}

// CRITICAL: merge, don't clobber. Keycloak's PUT /admin/realms/{realm} replaces the WHOLE realm rep,
// so we send the full current rep with only the OTP-policy fields overwritten — anything dropped is
// reset to defaults. Returns the body to PUT. Pure — unit-testable, zero-IO.
export function mergeOtpPolicy(
  current: Record<string, unknown>,
  patch: OtpPolicyPatch,
): Record<string, unknown> {
  return { ...current, ...otpPatchToRealmFields(patch) };
}

// Human-readable one-liner describing the policy strength, for the panel summary + audit context.
export function describeOtpPolicy(p: KcOtpPolicy): string {
  const scheme = p.type === 'totp' ? `time-based, ${p.period}s window` : 'counter-based (HOTP)';
  const reuse = p.codeReusable ? 'codes reusable' : 'single-use codes';
  return `${p.digits}-digit ${p.algorithm} ${scheme}, ${reuse}`;
}

// ── Identity-provider federation rollups ──────────────────────────────────────────
// Pure display helpers over the normalized IdP list (see normalizeIdps in keycloak-realm.ts). Used by
// the federation UI header so the operator sees the federation posture at a glance — kept pure and
// separate from the network list itself.

// A normalized IdP as surfaced by keycloak-realm.ts's normalizeIdp (only the fields the rollup reads).
export interface FederationIdp {
  alias: string;
  providerId: string;
  enabled: boolean;
}

// Map a Keycloak providerId to an operator-facing label. Unknown providers pass through unchanged so
// a new social/broker type still renders sensibly.
const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  oidc: 'OpenID Connect',
  saml: 'SAML 2.0',
  google: 'Google',
  microsoft: 'Microsoft',
  github: 'GitHub',
  'keycloak-oidc': 'Keycloak OIDC',
};

export function providerTypeLabel(providerId: string): string {
  return PROVIDER_LABELS[providerId] ?? providerId.toUpperCase();
}

export interface FederationSummary {
  total: number;
  enabled: number;
  disabled: number;
  byType: { providerId: string; label: string; count: number }[];
}

// Roll up the configured IdPs into counts by state and by provider type (sorted by descending count
// then alias-stable by label). Pure — the federation overview band renders straight from this.
export function summarizeFederation(idps: readonly FederationIdp[]): FederationSummary {
  const enabled = idps.filter((i) => i.enabled).length;
  const counts = new Map<string, number>();
  for (const i of idps) counts.set(i.providerId, (counts.get(i.providerId) ?? 0) + 1);
  const byType = [...counts.entries()]
    .map(([providerId, count]) => ({ providerId, label: providerTypeLabel(providerId), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { total: idps.length, enabled, disabled: idps.length - enabled, byType };
}
