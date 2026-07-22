// PURE connector-credential policy — ZERO I/O, fully unit-testable AND client-safe. Its only import
// is the sibling pure, zero-import SSRF host guard (connector-endpoint.ts) — no server-only graph, so
// it still rides into the client Add-connector form without dragging `pg`/the DB into the browser.
//
// This is the deciding half of the connector self-serve create path (the I/O half — the OpenBao
// write + secret_ref column — lives in connector-secrets.ts, which imports this).
//
// What it decides:
//   • the connector-type catalog (which types have a complete product path vs. coming-soon)
//   • per-type field validation (SQL, REST, and S3-compatible object stores)
//   • the CREDENTIAL-FREE endpoint the row stores (never the password/token)
//   • the SSRF host guard on every endpoint (create AND update reject private/link-local/loopback)
//   • splicing a vault-resolved secret back into the endpoint at query time
import {
  isInternalEnterpriseEndpoint,
  isPublicEndpointHost,
  isPublicHost,
} from '@/lib/connector-endpoint';

// ─── The connector-type catalog ───────────────────────────────────────────────
// `ready` means a complete usable path exists. SQL/REST use connector-exec; S3 uses the bounded
// connector object route and the existing S3 object-store port.

export type ConnectorFamily = 'sql' | 'rest' | 's3';

export interface ConnectorTypeDef {
  type: string; // stored on the connector row (matches detectDialect's expectations)
  label: string; // human label for the picker
  family: ConnectorFamily; // drives which field set the form shows
  scheme: string; // endpoint scheme the credential-free URL is built with (e.g. 'postgres')
  defaultPort?: number;
  status: 'ready' | 'coming-soon'; // 'ready' = create + its governed operation works end to end
  note?: string; // shown next to a coming-soon type
}

// Ordered for the picker. `ready` types are the ones a user can actually stand up and query today.
export const CONNECTOR_TYPES: ConnectorTypeDef[] = [
  { type: 'postgres', label: 'PostgreSQL', family: 'sql', scheme: 'postgres', defaultPort: 5432, status: 'ready' },
  { type: 'mysql', label: 'MySQL / MariaDB', family: 'sql', scheme: 'mysql', defaultPort: 3306, status: 'ready' },
  { type: 'mssql', label: 'SQL Server', family: 'sql', scheme: 'mssql', defaultPort: 1433, status: 'ready' },
  { type: 'rest', label: 'REST / HTTP API', family: 'rest', scheme: 'https', status: 'ready' },
  // Types without a complete user journey stay visible but disabled so no dead connector is made.
  { type: 'snowflake', label: 'Snowflake', family: 'sql', scheme: 'snowflake', status: 'coming-soon', note: 'Warehouse connector coming soon.' },
  { type: 's3', label: 'S3-compatible object store', family: 's3', scheme: 'https', status: 'ready' },
  { type: 'kafka', label: 'Kafka', family: 'rest', scheme: 'https', status: 'coming-soon', note: 'Streaming connector coming soon.' },
  { type: 'salesforce', label: 'Salesforce', family: 'rest', scheme: 'https', status: 'coming-soon', note: 'CRM connector coming soon.' },
  { type: 'gdrive', label: 'Google Drive', family: 'rest', scheme: 'https', status: 'coming-soon', note: 'Drive connector coming soon.' },
];

export function connectorTypeDef(type: string): ConnectorTypeDef | null {
  const t = (type ?? '').toLowerCase();
  return CONNECTOR_TYPES.find((d) => d.type === t) ?? null;
}

export function isCreatableType(type: string): boolean {
  return connectorTypeDef(type)?.status === 'ready';
}

// ─── The typed create input + validation ───────────────────────────────────────
export interface SqlConnectorInput {
  host?: unknown;
  port?: unknown;
  database?: unknown;
  user?: unknown;
  password?: unknown;
}

export interface RestConnectorInput {
  baseUrl?: unknown;
  apiKey?: unknown; // the token/api key; optional (public/unauth'd APIs)
}

export interface S3ConnectorInput {
  accessKey?: unknown;
  secretKey?: unknown;
}

export interface ConnectorCreateInput extends SqlConnectorInput, RestConnectorInput, S3ConnectorInput {
  name?: unknown;
  type?: unknown;
  description?: unknown;
}

// The normalized result of validating a create input: a credential-FREE endpoint the row can store,
// the secret value to push to the vault (null when there's none), the auth scheme, and the family.
export interface NormalizedConnectorCreate {
  name: string;
  type: string;
  family: ConnectorFamily;
  endpoint: string; // NEVER contains a password/token
  secret: string | null; // the password / api key, to be written to the vault (never persisted raw)
  auth: 'none' | 'api-key';
  description: string;
}

export interface CreateValidation {
  ok: boolean;
  value: NormalizedConnectorCreate | null;
  errors: string[];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// Only safe URL-authority characters for host; a bad host would corrupt the endpoint string.
const HOST_RE = /^[A-Za-z0-9.\-_]+$/;

// Build a credential-free SQL endpoint: `<scheme>://<user>@<host>:<port>/<db>`. The user is NOT a
// secret (it's needed to reach the server and is fine on the row); the PASSWORD is deliberately
// omitted and resolved from the vault at query time. `user` is percent-encoded so an "@"/":" in a
// username can't break the authority.
export function buildSqlEndpoint(def: ConnectorTypeDef, input: {
  host: string;
  port: number | null;
  database: string;
  user: string;
}): string {
  const port = input.port ?? def.defaultPort ?? null;
  const authority = input.user
    ? `${encodeURIComponent(input.user)}@${input.host}`
    : input.host;
  const hostPort = port ? `${authority}:${port}` : authority;
  const path = input.database ? `/${encodeURIComponent(input.database)}` : '';
  return `${def.scheme}://${hostPort}${path}`;
}

function validateSql(def: ConnectorTypeDef, input: SqlConnectorInput, name: string, description: string): CreateValidation {
  const errors: string[] = [];
  const host = str(input.host);
  const database = str(input.database);
  const user = str(input.user);
  const password = str(input.password);
  const portRaw = str(input.port);
  let port: number | null = def.defaultPort ?? null;
  if (portRaw) {
    const n = Number(portRaw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) errors.push('Port must be a number between 1 and 65535.');
    else port = n;
  }
  if (!host) errors.push('A host is required.');
  else if (!HOST_RE.test(host)) errors.push('Host contains invalid characters.');
  // SSRF: refuse a loopback / link-local / metadata / RFC-1918 host — the server would otherwise
  // open a connection into the private control plane. (G-ADV-DATA-2)
  else if (!isPublicHost(host)) errors.push('Host must be a public address (private/loopback hosts are blocked).');
  if (!database) errors.push('A database name is required.');
  if (!user) errors.push('A username is required.');
  if (!password) errors.push('A password is required.');
  if (errors.length) return { ok: false, value: null, errors };
  return {
    ok: true,
    value: {
      name,
      type: def.type,
      family: 'sql',
      endpoint: buildSqlEndpoint(def, { host, port, database, user }),
      secret: password,
      auth: 'api-key',
      description,
    },
    errors: [],
  };
}

function validateRest(def: ConnectorTypeDef, input: RestConnectorInput, name: string, description: string): CreateValidation {
  const errors: string[] = [];
  const baseUrl = str(input.baseUrl);
  const apiKey = str(input.apiKey);
  if (!baseUrl) {
    errors.push('A base URL is required.');
  } else {
    let u: URL | null = null;
    try {
      u = new URL(baseUrl);
    } catch {
      errors.push('Base URL must be a valid URL.');
    }
    if (u && u.protocol !== 'http:' && u.protocol !== 'https:') {
      errors.push('Base URL must use http:// or https://.');
    }
    // SSRF: refuse a loopback / link-local / metadata / RFC-1918 endpoint — the REST test/resources
    // path would otherwise fetch() the internal control plane. (G-ADV-DATA-2)
    if (u && !isPublicEndpointHost(baseUrl)) {
      errors.push('Base URL must be a public address (private/loopback hosts are blocked).');
    }
  }
  if (errors.length) return { ok: false, value: null, errors };
  return {
    ok: true,
    value: {
      name,
      type: def.type,
      family: 'rest',
      endpoint: baseUrl.replace(/\/$/, ''),
      secret: apiKey || null,
      auth: apiKey ? 'api-key' : 'none',
      description,
    },
    errors: [],
  };
}

export interface ObjectStoreCredential {
  accessKey: string;
  secretKey: string;
}

/** One keypair is retained as one opaque value by the existing per-connector vault owner. */
export function parseObjectStoreCredential(secret: string | null): ObjectStoreCredential | null {
  if (!secret) return null;
  try {
    const value = JSON.parse(secret) as Record<string, unknown>;
    const accessKey = typeof value.accessKey === 'string' ? value.accessKey.trim() : '';
    const secretKey = typeof value.secretKey === 'string' ? value.secretKey.trim() : '';
    if (!accessKey || !secretKey || accessKey.length > 256 || secretKey.length > 256) return null;
    return { accessKey, secretKey };
  } catch {
    return null;
  }
}

export function serializeObjectStoreCredential(credential: ObjectStoreCredential): string {
  return JSON.stringify({ accessKey: credential.accessKey, secretKey: credential.secretKey });
}

export function validateObjectStoreCredentialPatch(input: S3ConnectorInput): {
  ok: boolean;
  secret: string | null;
  errors: string[];
} {
  const accessKey = str(input.accessKey);
  const secretKey = str(input.secretKey);
  if (!accessKey && !secretKey) return { ok: true, secret: null, errors: [] };
  const errors: string[] = [];
  if (!accessKey) errors.push('An access key is required to rotate object-store credentials.');
  if (!secretKey) errors.push('A secret key is required to rotate object-store credentials.');
  if (accessKey.length > 256 || secretKey.length > 256) {
    errors.push('Object-store keys must be 256 characters or fewer.');
  }
  return errors.length
    ? { ok: false, secret: null, errors }
    : {
        ok: true,
        secret: serializeObjectStoreCredential({ accessKey, secretKey }),
        errors: [],
      };
}

function validateS3(
  def: ConnectorTypeDef,
  input: S3ConnectorInput & RestConnectorInput,
  name: string,
  description: string,
): CreateValidation {
  const errors: string[] = [];
  const baseUrl = str(input.baseUrl);
  const accessKey = str(input.accessKey);
  const secretKey = str(input.secretKey);
  let endpoint = '';
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      errors.push('Object-store endpoint must use http:// or https://.');
    } else if (url.username || url.password || url.search || url.hash) {
      errors.push('Object-store endpoint must not contain credentials, a query, or a fragment.');
    } else if (!isPublicEndpointHost(baseUrl) && !isInternalEnterpriseEndpoint(baseUrl)) {
      errors.push('Object-store endpoint is not an approved public or on-prem enterprise address.');
    } else {
      endpoint = baseUrl.replace(/\/$/, '');
    }
  } catch {
    errors.push('Object-store endpoint must be a valid URL.');
  }
  if (!accessKey) errors.push('An access key is required.');
  if (!secretKey) errors.push('A secret key is required.');
  if (accessKey.length > 256 || secretKey.length > 256) {
    errors.push('Object-store keys must be 256 characters or fewer.');
  }
  if (errors.length) return { ok: false, value: null, errors };
  return {
    ok: true,
    value: {
      name,
      type: def.type,
      family: 's3',
      endpoint,
      secret: serializeObjectStoreCredential({ accessKey, secretKey }),
      auth: 'api-key',
      description,
    },
    errors: [],
  };
}

// Validate + normalize a proposed create. Pure — the single gate the POST route goes through.
export function validateConnectorCreate(input: ConnectorCreateInput): CreateValidation {
  const name = str(input.name);
  const def = connectorTypeDef(str(input.type));
  if (!def) return { ok: false, value: null, errors: ['Unknown connector type.'] };
  if (def.status !== 'ready') {
    return { ok: false, value: null, errors: [`${def.label} connectors are not available yet.`] };
  }
  const description = str(input.description);
  const base =
    def.family === 'sql'
      ? validateSql(def, input, name, description)
      : def.family === 's3'
        ? validateS3(def, input, name, description)
        : validateRest(def, input, name, description);
  // A missing name is reported alongside the type-specific errors so the user sees everything at once.
  if (!name) {
    return { ok: false, value: null, errors: ['A connector name is required.', ...base.errors] };
  }
  return base;
}

// ─── The PATCH validator — DRY with create, so the edit path can't bypass validation ──────────────
// A PATCH is PARTIAL: only the fields present in the body are validated, but they are validated with
// the SAME rules create uses (creatable-type check + http/https-only + the SSRF host guard). Without
// this, PATCH /connectors/[id] forwarded body.type / body.endpoint straight to the store — letting an
// edit set a coming-soon/garbage type or repoint the endpoint at file:// / a metadata IP (G-ADV-DATA-2
// / G-ADV-DATA-3). Pure — the single gate the PATCH route runs before touching the store.
export interface ConnectorUpdateInput {
  type?: unknown;
  endpoint?: unknown;
}

export interface UpdateValidation {
  ok: boolean;
  errors: string[];
}

// The endpoint schemes an edit may set: http(s) for REST, plus the SQL connection schemes the create
// path builds. Anything else (file:, gopher:, ftp:, data:, …) is refused — matching create, which
// only ever produces one of these. Kept in-file (small, stable) to preserve the zero-server-import rule.
const UPDATE_ALLOWED_SCHEMES = new Set([
  'http:', 'https:', 'postgres:', 'postgresql:', 'mysql:', 'mariadb:', 'mssql:', 'sqlserver:',
]);

export function validateConnectorUpdate(patch: ConnectorUpdateInput): UpdateValidation {
  const errors: string[] = [];
  // A `type` in the body must be a creatable ('ready') type — exactly the create rule.
  if (patch.type !== undefined) {
    const def = connectorTypeDef(str(patch.type));
    if (!def) errors.push('Unknown connector type.');
    else if (def.status !== 'ready') errors.push(`${def.label} connectors are not available yet.`);
  }
  // An `endpoint` in the body must parse, use an allowed scheme (http(s) or a SQL scheme), and pass
  // the SSRF host guard — the same scheme + host discipline create enforces, so PATCH can't repoint a
  // connector at file:// / a metadata IP / a private host.
  if (patch.endpoint !== undefined) {
    const endpoint = str(patch.endpoint);
    if (!endpoint) {
      errors.push('Endpoint must not be empty.');
    } else {
      let u: URL | null = null;
      try {
        u = new URL(endpoint);
      } catch {
        errors.push('Endpoint must be a valid URL.');
      }
      if (u && !UPDATE_ALLOWED_SCHEMES.has(u.protocol)) {
        errors.push('Endpoint must use http:// or https:// (or a supported database URL).');
      }
      const isObjectStore = str(patch.type) === 's3';
      if (
        u &&
        !isPublicEndpointHost(endpoint) &&
        !(isObjectStore && isInternalEnterpriseEndpoint(endpoint))
      ) {
        errors.push(
          isObjectStore
            ? 'Object-store endpoint is not an approved public or on-prem enterprise address.'
            : 'Endpoint must be a public address (private/loopback hosts are blocked).',
        );
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// ─── The vault key path for a connector's secret ───────────────────────────────
// A per-connector KV key: `connectors/<id>/credential`. Same conservative charset as exporter
// secretRefs so it can only ever NAME a vault key, never smuggle a value.
export function connectorSecretKey(id: string): string {
  return `connectors/${id}/credential`;
}

// ─── Splice a resolved secret into a credential-free endpoint ───────────────────
// SQL: put the password into the URL authority (`scheme://user:PASS@host…`). If the endpoint already
// carries a password (legacy inline creds), leave it untouched. REST: no splice needed here — the
// api key is applied as a header at fetch time by connector-exec, so REST returns the endpoint as-is.
export function spliceCredential(type: string, endpoint: string, secret: string): string {
  const def = connectorTypeDef(type);
  if (def?.family !== 'sql') return endpoint;
  try {
    const u = new URL(endpoint);
    if (u.password) return endpoint; // already has creds — don't override
    u.password = secret;
    return u.toString();
  } catch {
    return endpoint;
  }
}
