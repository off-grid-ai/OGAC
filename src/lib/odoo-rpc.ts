// ─── Odoo JSON-RPC — PURE request/response shaping (zero IO) ──────────────────────────────────────
//
// Odoo's external API is JSON-RPC 2.0 over HTTP at `<base>/jsonrpc`. This module holds ONLY the pure
// parts of talking to it — parsing the connector endpoint into {base, db}, building the exact request
// bodies for `authenticate` and `search_read`, and parsing the responses — so they are fully
// unit-testable without a live server. connector-exec.ts is the thin I/O layer that fetches with
// these bodies and hands the responses back here to parse.
//
// SOLID: no `fetch`, no timers, no imports. Every function is a small, total transform that tolerates
// malformed input and returns null (never throws) on anything it doesn't understand — so the I/O layer
// degrades honestly (null → the caller records a miss, never a fabricated row).

// The two pieces the exec layer needs to reach an Odoo instance: the HTTP base URL (where /jsonrpc
// lives) and the database name (Odoo is multi-db; every call carries the db).
export interface OdooTarget {
  base: string;
  db: string;
}

// A JSON-RPC 2.0 request envelope as Odoo expects it. `id` is echoed back; we don't rely on it.
export interface OdooRpcRequest {
  jsonrpc: '2.0';
  method: 'call';
  params: {
    service: 'common' | 'object';
    method: string;
    args: unknown[];
  };
  id: number;
}

// Options for a search_read call — the read primitive we expose. All optional; sensible caps applied.
export interface SearchReadOptions {
  domain?: unknown[]; // Odoo search domain, e.g. [["is_company","=",true]]; default [] (all).
  fields?: string[]; // columns to return; default [] (Odoo returns a default set).
  limit?: number; // row cap; default 100, clamped to [1, 1000].
  offset?: number; // pagination offset; default 0.
}

// ─── parseOdooEndpoint — connector endpoint → {base, db} (PURE) ────────────────────────────────────
// Accepts the two DSN shapes the catalog documents:
//   odoo://user:password@host:8069/DBNAME   — scheme-style, db is the path segment
//   https://host/odoo?db=DBNAME             — HTTP-style, db is the `db` query param
// For the odoo:// form the scheme is rewritten to http/https for the actual /jsonrpc POST (Odoo speaks
// HTTP): a port of 443 (or an explicit `?ssl=1`) → https, otherwise http. Userinfo (login:password) is
// intentionally NOT part of the returned base — credentials are carried separately by the exec layer.
// Returns null when the string can't be parsed or no db can be determined.
export function parseOdooEndpoint(endpoint: string | undefined | null): OdooTarget | null {
  const raw = (endpoint ?? '').trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const scheme = u.protocol.replace(/:$/, '').toLowerCase();

  // db: prefer the ?db= query param, else the first meaningful path segment (skipping odoo/jsonrpc).
  const dbFromQuery = u.searchParams.get('db')?.trim();
  const pathSeg = u.pathname
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.toLowerCase() !== 'odoo' && s.toLowerCase() !== 'jsonrpc');
  const db = dbFromQuery || pathSeg[0] || '';
  if (!db) return null;

  const host = u.hostname;
  if (!host) return null;

  // Decide http vs https for the actual POST. Explicit https/http schemes win; odoo:// (or anything
  // else) infers from port 443 or an `?ssl=1`/`?ssl=true` hint.
  let httpProtocol: 'http:' | 'https:';
  if (scheme === 'https') {
    httpProtocol = 'https:';
  } else if (scheme === 'http') {
    httpProtocol = 'http:';
  } else {
    const sslHint = u.searchParams.get('ssl');
    httpProtocol = u.port === '443' || sslHint === '1' || sslHint === 'true' ? 'https:' : 'http:';
  }

  // Keep any explicit port except a redundant :443 on https.
  const cleanPort = u.port && !(u.port === '443' && httpProtocol === 'https:') ? `:${u.port}` : '';
  const base = `${httpProtocol}//${host}${cleanPort}`;
  return { base, db };
}

// ─── Credential extraction (PURE) ─────────────────────────────────────────────────────────────────
// The login (Odoo user) may be encoded in the endpoint userinfo (odoo://LOGIN:pass@host/db). The
// password is the VAULTED secret and is resolved by the exec layer, not here — but as a fallback for
// already-seeded inline-credential connectors we also expose the inline password. Returns login/pass
// or empty strings when absent.
export function parseOdooCredentials(
  endpoint: string | undefined | null,
): { login: string; password: string } {
  const raw = (endpoint ?? '').trim();
  if (!raw) return { login: '', password: '' };
  try {
    const u = new URL(raw);
    return {
      login: u.username ? decodeURIComponent(u.username) : '',
      password: u.password ? decodeURIComponent(u.password) : '',
    };
  } catch {
    return { login: '', password: '' };
  }
}

// ─── buildAuthPayload — the `common.authenticate` request body (PURE) ──────────────────────────────
// POST <base>/jsonrpc with this to exchange (db, login, password) for a uid.
export function buildAuthPayload(db: string, login: string, password: string): OdooRpcRequest {
  return {
    jsonrpc: '2.0',
    method: 'call',
    params: { service: 'common', method: 'authenticate', args: [db, login, password, {}] },
    id: 1,
  };
}

// ─── buildSearchReadPayload — the `object.execute_kw` / search_read request body (PURE) ─────────────
// Reads records of `model` matching `domain`, returning `fields`, capped at `limit`. This is the READ
// primitive; there is deliberately no write builder (execConnectorQuery is READ-only by design).
export function buildSearchReadPayload(
  db: string,
  uid: number,
  password: string,
  model: string,
  opts: SearchReadOptions = {},
): OdooRpcRequest {
  const domain = Array.isArray(opts.domain) ? opts.domain : [];
  const fields = Array.isArray(opts.fields) ? opts.fields : [];
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 1000));
  const offset = Math.max(0, opts.offset ?? 0);
  const kwargs: Record<string, unknown> = { fields, limit, offset };
  return {
    jsonrpc: '2.0',
    method: 'call',
    params: {
      service: 'object',
      method: 'execute_kw',
      args: [db, uid, password, model, 'search_read', [domain], kwargs],
    },
    id: 1,
  };
}

// ─── buildModelListPayload — list installed models via ir.model (PURE) ─────────────────────────────
// search_read of `ir.model` returning the technical `model` name of each — used by listResources to
// let the operator pick a model instead of hand-typing one.
export function buildModelListPayload(db: string, uid: number, password: string): OdooRpcRequest {
  return buildSearchReadPayload(db, uid, password, 'ir.model', {
    fields: ['model', 'name'],
    limit: 1000,
  });
}

// ─── Response parsers (PURE) ───────────────────────────────────────────────────────────────────────
// Odoo JSON-RPC wraps the result as `{jsonrpc, id, result}` on success and `{jsonrpc, id, error:{…}}`
// on failure. Every parser tolerates both shapes plus arbitrary malformed input and returns null on
// anything it doesn't recognise — never throws.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Extract the `result` field only when the body is well-formed and carries NO error. Returns
// {ok:false} on an error body or malformed input, so callers map to null.
function extractResult(body: unknown): { ok: true; result: unknown } | { ok: false } {
  if (!isRecord(body)) return { ok: false };
  if ('error' in body && body.error != null) return { ok: false };
  if (!('result' in body)) return { ok: false };
  return { ok: true, result: body.result };
}

// parseAuthResult — the authenticate response → a uid (positive int) or null. Odoo returns `false`
// for bad credentials, which must map to null (auth failed), and an integer uid on success.
export function parseAuthResult(body: unknown): number | null {
  const r = extractResult(body);
  if (!r.ok) return null;
  const uid = r.result;
  if (typeof uid === 'number' && Number.isInteger(uid) && uid > 0) return uid;
  return null;
}

// parseSearchReadResult — the search_read response → an array of record objects, or null. A non-array
// result (or an error body) is a miss → null. Non-object array entries are dropped defensively.
export function parseSearchReadResult(body: unknown): Record<string, unknown>[] | null {
  const r = extractResult(body);
  if (!r.ok) return null;
  if (!Array.isArray(r.result)) return null;
  return r.result.filter(isRecord);
}

// parseModelListResult — the ir.model search_read response → the list of technical model names, or
// null. Filters to non-empty string `model` fields; an empty (but valid) result yields [].
export function parseModelListResult(body: unknown): string[] | null {
  const rows = parseSearchReadResult(body);
  if (rows === null) return null;
  return rows
    .map((row) => row.model)
    .filter((m): m is string => typeof m === 'string' && m.trim().length > 0);
}
