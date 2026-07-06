// Pure device data-plane token logic — zero I/O, exhaustively unit-testable.
//
// The device data-plane (`/api/v1/devices/[id]/{audit,policy,commands}`) is public in middleware
// because it authenticates with a per-device token, not user SSO. Historically that token was the
// PREDICTABLE `dt_<id>` — anyone who knew/guessed a device id could forge audit records, drain a
// node's command queue, or pull its policy. This module holds the pure rules for the hardened token:
// a RANDOM per-device secret minted at enrollment, stored on the device row, presented as a Bearer.
//
// The random-secret MINTING (needs crypto) and the device-row READ (needs DB) live in store.ts /
// the enroll route; this module is the pure decision surface they call.

// Extract the bearer credential from an Authorization header value. Case-insensitive on the scheme,
// tolerant of surrounding whitespace. Returns '' when absent/malformed so callers compare against a
// concrete string (never undefined). Pure.
export function bearerFromHeader(authorization: string | null | undefined): string {
  if (!authorization) return '';
  return authorization.replace(/^Bearer\s+/i, '').trim();
}

// The legacy predictable token for a device id. Still ACCEPTED (backward-tolerant) for devices
// enrolled before per-device secrets existed and that therefore have no stored `token` — those rows
// carry a null/empty token and can only present `dt_<id>` until they re-enroll. A device that HAS a
// stored random token no longer accepts its legacy form. Pure.
export function legacyDeviceToken(id: string): string {
  return `dt_${id}`;
}

// Decide whether a presented bearer authenticates the given device id. Rules (pure):
//   1. Constant-time-ish exact match against the device's stored random secret, when it has one.
//   2. Backward tolerance: a device WITHOUT a stored secret (null/empty — enrolled before this
//      hardening) accepts only its legacy `dt_<id>` form, so existing fleets keep working until they
//      re-enroll. A device WITH a stored secret does NOT accept the legacy form (upgrade closes it).
//   3. Empty presented bearer never authenticates.
export function verifyDeviceToken(
  id: string,
  presented: string | null | undefined,
  storedToken: string | null | undefined,
): boolean {
  const bearer = (presented ?? '').trim();
  if (!bearer) return false;
  const stored = (storedToken ?? '').trim();
  if (stored) return timingSafeEqualStr(bearer, stored);
  // No stored secret → backward-tolerant legacy path.
  return timingSafeEqualStr(bearer, legacyDeviceToken(id));
}

// Length-independent, early-exit-free string comparison. Not a cryptographic guarantee on its own
// (JS strings), but avoids the trivial short-circuit an `===` would give a timing attacker. Pure.
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
