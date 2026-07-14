// ─── Odoo JSON-RPC — PURE protocol layer (zero I/O) ───────────────────────────────────────────────
//
// Everything here is pure: it parses a stored Odoo endpoint into {base, db}, builds the JSON-RPC
// request bodies Odoo expects, and parses Odoo's response envelopes into the value the caller wants
// (or null when the body is an error / malformed). The actual HTTP POST lives in connector-exec.ts —
// this module never touches the network, so the whole protocol contract is unit-testable.
//
// Odoo speaks JSON-RPC 2.0 over HTTP POST to `<base>/jsonrpc`. Two services matter:
//   common → authenticate(db, login, password, {})            → uid (int) | false
//   object → execute_kw(db, uid, password, model, method, …)  → the method's result
// We use execute_kw with method "search_read" (query records) and "search_count" (count), plus
// "fields_get" is avoided — model discovery is done with a bounded search_read of ir.model instead.
//
// HONESTY: every parse returns null on an `{error}` envelope or a malformed/absent `result`, so the
// I/O layer degrades to an honest miss rather than fabricating rows.

// The two coordinates the I/O layer needs to reach an Odoo instance: the HTTP base (where /jsonrpc
// lives) and the database name (Odoo is multi-db; every RPC is scoped to one db).
export interface OdooEndpoint {
  base: string;
  db: string;
}

// ─── parseOdooEndpoint — turn a stored endpoint string into {base, db} ────────────────────────────
// Accepts two operator-facing forms:
//   odoo://user:pass@host:8069/DBNAME   → base http://host:8069, db DBNAME  (login/pass are userinfo)
//   https://host/odoo?db=DBNAME         → base https://host/odoo,  db DBNAME (db in the query string)
// The `odoo://` scheme is normalised to http (Odoo's default transport); when the odoo:// authority
// carries no port we keep it portless. The db is REQUIRED — no db means we can't scope any RPC, so
// we return null (honest: the caller degrades rather than guessing a db). Returns null on any
// malformed URL.
export function parseOdooEndpoint(endpoint: string): OdooEndpoint | null {
  const raw = (endpoint ?? '').trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const scheme = u.protocol.replace(/:$/, '').toLowerCase();

  if (scheme === 'odoo') {
    // odoo://[user[:pass]@]host[:port]/DBNAME  — db is the first path segment.
    const db = decodeURIComponent(u.pathname.replace(/^\/+/, '').split('/')[0] ?? '');
    if (!db) return null;
    const port = u.port ? `:${u.port}` : '';
    const base = `http://${u.hostname}${port}`;
    return { base, db };
  }

  if (scheme === 'http' || scheme === 'https') {
    // https://host[/path]?db=DBNAME — db comes from the query string; the path is kept in the base.
    const db = (u.searchParams.get('db') ?? '').trim();
    if (!db) return null;
    const path = u.pathname.replace(/\/+$/, '');
    const base = `${scheme}://${u.host}${path}`;
    return { base, db };
  }

  return null;
}

// The login carried in an odoo:// endpoint's userinfo (the password is the VAULTED secret, never the
// endpoint). Returns 'admin' as Odoo's conventional default when no user is present. Never returns
// the password — that comes from the vault at query time.
export function parseOdooLogin(endpoint: string): string {
  try {
    const u = new URL((endpoint ?? '').trim());
    const user = decodeURIComponent(u.username || '');
    return user || 'admin';
  } catch {
    return 'admin';
  }
}

// The password carried inline in an odoo:// endpoint's userinfo, if any. The vault is the primary
// source (resolved at query time by connector-exec), but a legacy seeded endpoint may carry the
// password inline — this lets the credential-less recordCount path still authenticate. Returns '' when
// there's no inline password or the input is malformed (never guesses one).
export function parseOdooInlinePassword(endpoint: string): string {
  try {
    const u = new URL((endpoint ?? '').trim());
    return decodeURIComponent(u.password || '');
  } catch {
    return '';
  }
}

// ─── Request-body builders (pure) ─────────────────────────────────────────────────────────────────
// Each returns the exact JSON-RPC 2.0 envelope Odoo expects. `id` defaults to 1 (Odoo echoes it but
// we don't rely on it). Kept as plain objects so the I/O layer just JSON.stringify's them.

export interface JsonRpcCall {
  jsonrpc: '2.0';
  method: 'call';
  params: Record<string, unknown>;
  id: number;
}

// authenticate(db, login, password, {}) on the `common` service → uid.
export function buildAuthPayload(db: string, login: string, password: string, id = 1): JsonRpcCall {
  return {
    jsonrpc: '2.0',
    method: 'call',
    params: {
      service: 'common',
      method: 'authenticate',
      args: [db, login, password, {}],
    },
    id,
  };
}

// execute_kw(db, uid, password, model, "search_read", [domain], {fields, limit, offset}) on `object`.
// `domain` is an Odoo search domain (array of triples); default [] = all records. `fields` empty =
// all fields. `limit` is clamped to a sane bound by the caller before it reaches here.
export function buildSearchReadPayload(
  args: {
    db: string;
    uid: number;
    password: string;
    model: string;
    fields?: string[];
    domain?: unknown[];
    limit?: number;
    offset?: number;
  },
  id = 1,
): JsonRpcCall {
  const kwargs: Record<string, unknown> = {};
  if (args.fields && args.fields.length > 0) kwargs.fields = args.fields;
  if (typeof args.limit === 'number') kwargs.limit = args.limit;
  if (typeof args.offset === 'number') kwargs.offset = args.offset;
  return {
    jsonrpc: '2.0',
    method: 'call',
    params: {
      service: 'object',
      method: 'execute_kw',
      args: [args.db, args.uid, args.password, args.model, 'search_read', [args.domain ?? []], kwargs],
    },
    id,
  };
}

// execute_kw(db, uid, password, "ir.model", "search_read", [[]], {fields:["model"]}) — enumerate the
// models installed on the instance so the operator PICKS a model instead of hand-typing one. Bounded.
export function buildModelListPayload(
  args: { db: string; uid: number; password: string; limit?: number },
  id = 1,
): JsonRpcCall {
  return buildSearchReadPayload(
    {
      db: args.db,
      uid: args.uid,
      password: args.password,
      model: 'ir.model',
      fields: ['model'],
      domain: [],
      limit: args.limit ?? 500,
    },
    id,
  );
}

// ─── Response parsers (pure) ──────────────────────────────────────────────────────────────────────
// Odoo wraps every response as {jsonrpc, id, result} on success or {jsonrpc, id, error:{…}} on
// failure. Each parser tolerates both, plus arbitrary malformed shapes, and returns null on anything
// that isn't the expected success payload — so the I/O layer records an honest miss.

// True when the envelope is a plain object carrying an `error` key (any truthy value).
function isErrorEnvelope(body: unknown): boolean {
  return !!body && typeof body === 'object' && 'error' in (body as Record<string, unknown>) &&
    (body as Record<string, unknown>).error != null;
}

// Extract the `result` field from a success envelope, or null if it's an error / not an object.
function resultOf(body: unknown): unknown {
  if (!body || typeof body !== 'object') return null;
  if (isErrorEnvelope(body)) return null;
  return (body as Record<string, unknown>).result;
}

// authenticate → uid. Odoo returns an int uid on success, or `false` for bad credentials. We return
// the uid only when it's a positive integer; false / 0 / non-number / error → null (auth failed).
export function parseAuthResult(body: unknown): number | null {
  const result = resultOf(body);
  if (typeof result === 'number' && Number.isInteger(result) && result > 0) return result;
  return null;
}

// search_read → an array of record objects. Returns the rows on a well-formed array result; null on
// an error envelope, a missing result, or a non-array (never coerces a scalar into rows).
export function parseSearchReadResult(body: unknown): Record<string, unknown>[] | null {
  const result = resultOf(body);
  if (!Array.isArray(result)) return null;
  // Keep only object rows; Odoo search_read always yields objects, but guard against odd payloads.
  return result.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));
}

// ir.model search_read → the list of model technical names (the `model` field of each row). Returns
// the de-duplicated, sorted names; null on error / malformed. Rows without a string `model` are
// dropped rather than faked.
export function parseModelListResult(body: unknown): string[] | null {
  const rows = parseSearchReadResult(body);
  if (rows === null) return null;
  const names = new Set<string>();
  for (const row of rows) {
    const m = row.model;
    if (typeof m === 'string' && m.length > 0) names.add(m);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
