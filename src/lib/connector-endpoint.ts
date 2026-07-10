// PURE connector-endpoint parsing — ZERO imports, ZERO I/O, fully unit-testable AND client-safe.
//
// The companion of connector-policy.ts's `spliceCredential` (reassembly). This file owns the OTHER
// direction: SPLITTING a possibly-credential-bearing connection string into a credential-FREE
// endpoint + the extracted secret. It is the single gate the edit/update path runs an endpoint
// through so a user who pastes `mssql://sa:PASS@host/db` (or rotates a password) never lands the
// password back in the DB — it's peeled off here and vaulted by the I/O layer.
//
// Why a second parse helper (vs. reusing spliceCredential)? spliceCredential goes endpoint+secret →
// runtime URL. This goes URL → {sanitized endpoint, secret}. Together they round-trip, and both are
// pure so the split decision is unit-tested away from any vault/DB. DRY: the reassembly stays in
// connector-policy; this is the inverse, not a copy.

// The result of peeling a credential off an endpoint string.
export interface SplitEndpoint {
  // The endpoint with any embedded password/userinfo-password removed. Safe to persist on the row.
  endpoint: string;
  // The extracted secret (the SQL password), or null when the endpoint carried none. REST base URLs
  // never carry a secret in the URL (the api key is a header), so they always split to secret=null.
  secret: string | null;
}

// Which endpoints can carry an embedded SQL password we must strip. Mirrors connector-policy's SQL
// family + the schemes detectDialect understands. Kept here (not imported) to stay zero-import; the
// set is tiny and stable, and connector-policy owns the authoritative catalog for everything else.
const SQL_SCHEMES = new Set(['postgres', 'postgresql', 'mysql', 'mariadb', 'mssql', 'sqlserver']);

// True when `endpoint` is a SQL connection URL whose authority carries a password segment
// (`scheme://user:PASS@host…`). Pure predicate — used by the update path to decide whether the
// pasted endpoint smuggled a credential that must be peeled + vaulted.
export function endpointHasEmbeddedSecret(endpoint: string): boolean {
  return splitEndpointSecret(endpoint).secret !== null;
}

// Split a connection string into a credential-FREE endpoint + the extracted password.
//   - SQL URL with a password  → strips the `:PASS` from the authority, returns it as `secret`.
//   - SQL URL without password → returned unchanged, secret=null.
//   - REST / non-URL / unparseable → returned unchanged, secret=null (REST keys aren't in the URL,
//     and we never corrupt a string we can't confidently parse).
// The username is preserved on the endpoint (it's not a secret and is needed to reach the server).
export function splitEndpointSecret(endpoint: string): SplitEndpoint {
  const raw = (endpoint ?? '').trim();
  if (!raw) return { endpoint: raw, secret: null };
  // Cheap scheme guard so a non-URL string (or a REST base URL) is passed straight through.
  const scheme = raw.slice(0, Math.max(0, raw.indexOf(':'))).toLowerCase();
  if (!SQL_SCHEMES.has(scheme)) return { endpoint: raw, secret: null };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { endpoint: raw, secret: null };
  }
  if (!u.password) return { endpoint: raw, secret: null };
  const secret = decodeURIComponent(u.password);
  u.password = '';
  // URL.toString() drops the now-empty password but keeps `user@`. Guard against a stray trailing
  // ':' some engines leave in the authority when only the password is cleared.
  const sanitized = u.toString().replace(/:@/, '@');
  return { endpoint: sanitized, secret };
}

// ─── SSRF host guard (G-ADV-DATA-2) ────────────────────────────────────────────
// A connector's `endpoint` is fetched server-side (REST fetch, or a pg/mysql/mssql connect) by the
// admin test / resources / sync / query paths. Without a host guard, a connector whose endpoint is
// the cloud metadata IP (169.254.169.254), a loopback (127.0.0.1 / localhost / ::1) or an RFC-1918
// private address (10./172.16-31./192.168., link-local 169.254.) is an admin-gated SSRF pivot into
// the private control plane (the internal warehouse, the vault, cloud metadata). This is the pure
// rule the create + update validators apply so BOTH paths reject a private host before storing or
// fetching. Kept here (zero-import) so it rides into the client Add-connector form.

// Hostnames that always resolve to the local machine.
const LOOPBACK_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);

// Strip an IPv6 zone id and surrounding brackets so `[fe80::1%eth0]` compares as `fe80::1`.
function normalizeHost(rawHost: string): string {
  let h = rawHost.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  const zone = h.indexOf('%');
  if (zone >= 0) h = h.slice(0, zone);
  return h;
}

// Parse a dotted-quad IPv4 into its four octets, or null if it isn't one. Rejects octets > 255 and
// non-numeric parts so a hostname like `a.b.c.d` isn't mistaken for an IP.
function ipv4Octets(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums as [number, number, number, number];
}

// True for an IPv4 that MUST NOT be reachable from the server: loopback (127.), link-local +
// metadata (169.254., which includes 169.254.169.254), RFC-1918 private (10., 172.16-31.,
// 192.168.), "this host" (0.), and carrier-grade NAT (100.64-127.).
function isPrivateIpv4([a, b]: [number, number, number, number]): boolean {
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC-1918
  if (a === 0) return true; // "this host"
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC-1918
  if (a === 192 && b === 168) return true; // RFC-1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

// True for an IPv6 literal that MUST NOT be reachable: loopback (::1), unspecified (::), link-local
// (fe80::/10), unique-local (fc00::/7), and IPv4-mapped (::ffff:a.b.c.d) that maps to a private v4.
function isPrivateIpv6(host: string): boolean {
  if (host === '::1' || host === '::') return true;
  if (host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) {
    return true; // fe80::/10 link-local
  }
  if (host.startsWith('fc') || host.startsWith('fd')) return true; // fc00::/7 unique-local
  const mapped = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) {
    const oct = ipv4Octets(mapped[1]);
    return oct ? isPrivateIpv4(oct) : true;
  }
  return false;
}

/**
 * Is this HOSTNAME (already extracted from a URL) safe to reach from the server? Rejects loopback
 * hostnames and IPv4/IPv6 loopback/link-local/private/metadata literals. A public DNS name (not
 * resolvable purely here) is allowed — the deterministic literal + well-known-name checks are the
 * defense-in-depth layer this pure guard owns.
 */
export function isPublicHost(host: string): boolean {
  const h = normalizeHost(host);
  if (!h) return false;
  if (LOOPBACK_HOSTNAMES.has(h)) return false;
  const v4 = ipv4Octets(h);
  if (v4) return !isPrivateIpv4(v4);
  if (h.includes(':')) return !isPrivateIpv6(h);
  return true;
}

/**
 * Is this ENDPOINT (a full URL string) safe to fetch/connect server-side? Parses the URL and applies
 * isPublicHost to its hostname. An unparseable endpoint is rejected (false) — a connector we can't
 * parse a host from must not be stored or reached. The scheme is validated separately by the
 * create/update validators; this owns the host-reachability half.
 */
export function isPublicEndpointHost(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return isPublicHost(u.hostname);
  } catch {
    return false;
  }
}
