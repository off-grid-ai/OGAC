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
