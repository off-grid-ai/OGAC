// Pure view-model helpers for Keycloak session lifetime — age and projected expiry. Zero I/O, so
// it is unit-testable and safe to import from both the sessions route (server) and the session
// tables (client). Keycloak's session list carries `start` and `lastAccess` but NOT when a session
// will expire; expiry is derived from the realm's configured timeouts (see keycloak-realm.ts). This
// is the single source of that derivation so the route and UI never drift.

import type { KcRealmLifetimes } from './keycloak-realm';
import { formatDuration } from './keycloak-realm';

// The lifetime fields of a normalized session this module needs (subset of KcSession).
export interface SessionTiming {
  start: number; // ms epoch
  lastAccess: number; // ms epoch
  offline: boolean;
}

export interface SessionLifetime {
  ageMs: number; // now - start (never negative)
  expiresAt: number | null; // ms epoch of projected expiry, or null when the relevant timeout is unknown
  ttlMs: number | null; // expiresAt - now (may be negative when already expired), null when unknown
  expired: boolean; // true iff we can project an expiry AND it is in the past
}

// The seconds-valued timeouts that bound a session's life. Online (SSO) sessions expire at the
// earlier of (lastAccess + idle) and (start + max). Offline (refresh-backed) sessions are bounded by
// the offline idle timeout. A timeout of 0 in Keycloak means "no cap for this dimension", so it is
// treated as absent (no bound contributed).
function boundedExpiry(timing: SessionTiming, lifetimes: KcRealmLifetimes): number | null {
  const candidates: number[] = [];
  if (timing.offline) {
    const idle = lifetimes.offlineSessionIdleTimeout;
    if (idle && idle > 0) candidates.push(timing.lastAccess + idle * 1000);
  } else {
    const idle = lifetimes.ssoSessionIdleTimeout;
    if (idle && idle > 0) candidates.push(timing.lastAccess + idle * 1000);
    const max = lifetimes.ssoSessionMaxLifespan;
    if (max && max > 0) candidates.push(timing.start + max * 1000);
  }
  if (candidates.length === 0) return null;
  // The session dies at the FIRST cap it hits.
  return Math.min(...candidates);
}

// Derive age + projected expiry for one session against the realm lifetimes at `now`.
export function computeSessionLifetime(
  timing: SessionTiming,
  lifetimes: KcRealmLifetimes | null,
  now: number,
): SessionLifetime {
  const ageMs = Math.max(0, now - timing.start);
  if (!lifetimes) {
    return { ageMs, expiresAt: null, ttlMs: null, expired: false };
  }
  const expiresAt = boundedExpiry(timing, lifetimes);
  if (expiresAt === null) {
    return { ageMs, expiresAt: null, ttlMs: null, expired: false };
  }
  const ttlMs = expiresAt - now;
  return { ageMs, expiresAt, ttlMs, expired: ttlMs <= 0 };
}

// Annotate a session object (any shape with start/lastAccess/offline) with its computed lifetime,
// returning a new object so the input is never mutated. Used server-side in the sessions route to
// enrich each row before it reaches the client.
export function annotateSessionLifetime<T extends SessionTiming>(
  session: T,
  lifetimes: KcRealmLifetimes | null,
  now: number,
): T & SessionLifetime {
  return { ...session, ...computeSessionLifetime(session, lifetimes, now) };
}

// Annotate a whole list.
export function annotateSessionLifetimes<T extends SessionTiming>(
  sessions: T[],
  lifetimes: KcRealmLifetimes | null,
  now: number,
): (T & SessionLifetime)[] {
  return sessions.map((s) => annotateSessionLifetime(s, lifetimes, now));
}

// ── Formatters (for the UI; pure) ──────────────────────────────────────────────

// "3h 12m" for an age. Reuses the realm duration formatter (DRY) on whole seconds.
export function formatAge(ageMs: number): string {
  if (ageMs < 0) return '—';
  return formatDuration(Math.floor(ageMs / 1000));
}

// Human expiry phrase from a TTL: "expired", "in 12m", or "—" when unknown.
export function formatExpiry(ttlMs: number | null): string {
  if (ttlMs === null) return '—';
  if (ttlMs <= 0) return 'expired';
  return `in ${formatDuration(Math.ceil(ttlMs / 1000))}`;
}
