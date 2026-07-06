// vectordb-allowlist — PURE, zero-IO SSRF defense for the vector-DB inspector.
//
// The inspector route (`/api/v1/vectordb`) is admin-gated (P0 fix), but a request-supplied `url`
// is still an SSRF surface: an admin (or a compromised admin session) could point the server at an
// arbitrary internal host and use the response shapes (ping / collections / sample) as a probe.
// Defense-in-depth: before we CONNECT, the target host must be on an allowlist.
//
// Allowlist rule (host-only; scheme/port/path are irrelevant to the SSRF surface):
//   1. Loopback (127.0.0.1 / localhost / ::1 / 0.0.0.0) — the console reaches on-prem stores over
//      loopback. Always allowed.
//   2. The org's configured vector-store host — the host of `OFFGRID_QDRANT_URL`. Always allowed.
//   3. Otherwise REJECT — unless `OFFGRID_VECTORDB_ALLOW_EXTERNAL` is a truthy opt-in, in which case
//      any host is allowed (explicit escape hatch for multi-store / dev setups).
//
// Note: the caller normalizes UI mDNS hosts (offgrid-s1.local) back to loopback via `toConnectHost`
// BEFORE validation, so a display host resolves to loopback and passes rule 1. This validator only
// sees real connect targets.

// Structurally compatible with `process.env` (a Record<string, string | undefined>) so the route
// can pass it directly, while tests can pass a tiny literal.
export type VectorDbAllowlistEnv = Record<string, string | undefined>;

export interface AllowlistResult {
  allowed: boolean;
  reason?: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0', '::1', '[::1]']);

// Truthy opt-in: '1', 'true', 'yes', 'on' (case-insensitive). Empty/undefined/'false'/'0' → off.
export function allowExternal(env: VectorDbAllowlistEnv): boolean {
  const v = (env.OFFGRID_VECTORDB_ALLOW_EXTERNAL ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

// Extract the bare hostname (lowercased, no brackets, no port, no path) from a URL, host:port, or
// bare host. Returns null when it can't be parsed into something with a host. Pure.
export function hostOf(input: string | null | undefined): string | null {
  if (input == null) return null;
  const value = String(input).trim();
  if (!value) return null;

  // Full URL form.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
    try {
      const u = new URL(value);
      return normalizeHost(u.hostname);
    } catch {
      return null;
    }
  }

  // Strip any path first.
  const slash = value.indexOf('/');
  const authority = slash === -1 ? value : value.slice(0, slash);

  // IPv6 bracket form [::1]:6333 → ::1
  const v6 = /^\[([^\]]+)\](?::\d+)?$/.exec(authority);
  if (v6) return normalizeHost(v6[1]);

  const colon = authority.lastIndexOf(':');
  if (colon !== -1 && /^\d+$/.test(authority.slice(colon + 1))) {
    return normalizeHost(authority.slice(0, colon));
  }
  return normalizeHost(authority);
}

function normalizeHost(h: string): string | null {
  const s = h.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return s || null;
}

function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || LOOPBACK_HOSTS.has(`[${host}]`);
}

/**
 * Is `url` a safe vector-DB connect target for the given env? PURE — no IO, exhaustively testable.
 * `url` should already be the real connect target (run `toConnectHost` on any UI-supplied value
 * first). An unparseable/host-less input is rejected (fail-closed).
 */
export function isAllowedVectorDbUrl(
  url: string | null | undefined,
  env: VectorDbAllowlistEnv,
): AllowlistResult {
  if (allowExternal(env)) return { allowed: true };

  const host = hostOf(url);
  if (!host) return { allowed: false, reason: 'unparseable or missing host' };

  if (isLoopback(host)) return { allowed: true };

  const configuredHost = hostOf(env.OFFGRID_QDRANT_URL);
  if (configuredHost && host === configuredHost) return { allowed: true };

  return {
    allowed: false,
    reason: `host "${host}" is not an allowed vector-store target (set OFFGRID_VECTORDB_ALLOW_EXTERNAL=1 to permit external hosts)`,
  };
}
