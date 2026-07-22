// ─── Curated DATA-CONNECTOR CATALOG (Task #127) — PURE, zero-IO ───────────────────────────────────
//
// The Data/Connectors surface should let an operator ONE-CLICK add a data source from a curated list
// instead of hand-configuring a raw connector. This is the MCP-catalog pattern (mcp-catalog.ts) but
// for DATA SOURCES: a static, curated catalog of real connector types + the pure add-payload builder.
// It holds NO I/O — the browse-and-add UI (a thin client component) consumes it, and the actual
// connector is written through the EXISTING connector-create route (POST /api/v1/admin/connectors →
// createConnector). We do NOT duplicate connector storage; the catalog is static metadata + an "add"
// action that prefills the create form.
//
// ── GROUNDED IN WHAT THE BACKEND CAN REPRESENT ────────────────────────────────────────────────────
// Every entry's `connectorType` string is what `createConnector({type})` stores and what
// connector-exec.ts:detectDialect() reads. detectDialect only opens a LIVE connection for four
// dialects — postgres, mysql, mssql, and rest/http. Everything else is stored as connector METADATA
// (directory + binding) but cannot be live-queried yet: we flag those honestly with `liveQuery:false`
// so the UI never implies a warehouse/streaming/NoSQL source will actually stream rows. The auth
// kinds mirror the create route's accepted set (none | api-key | oauth), extended with the
// data-plane realities `password` (DB DSN) and `s3-keys` (access/secret key pair) that the UI
// collects into the endpoint/description — the stored `auth` column is always narrowed back to the
// route-accepted value by buildAddPayload.
//
// Connector types are the real, common ones seeded in deploy/onprem/data-sources.yml
// (postgres, mysql, mssql, rest, s3, kafka) plus the widely-known enterprise sources. Nothing exotic
// is invented.

// ─── Category — the group a connector sorts under in the browse UI ────────────────────────────────
export type ConnectorCategory =
  | 'Relational DB'
  | 'Warehouse'
  | 'Object store'
  | 'Streaming'
  | 'SaaS/REST'
  | 'NoSQL';

export const CONNECTOR_CATEGORIES: ConnectorCategory[] = [
  'Relational DB',
  'Warehouse',
  'Object store',
  'Streaming',
  'SaaS/REST',
  'NoSQL',
];

// ─── Auth kind — how the operator authenticates to the source ─────────────────────────────────────
// These are the auth SHAPES the catalog collects. `none | api-key | oauth` map 1:1 to the values the
// connector-create route accepts. `password` (a DB DSN carries user:pass inline) and `s3-keys`
// (access-key + secret-key) are data-plane realities the form collects into the endpoint/description;
// buildAddPayload narrows the STORED `auth` column back to a route-accepted value.
export type AuthKind = 'none' | 'password' | 'api-key' | 'oauth' | 's3-keys';

// ─── Field — one input the add form prefills/collects for a connector type ────────────────────────
export interface ConnectorField {
  /** Stable key (used as the form input id + payload assembly). */
  key: string;
  /** Human label shown next to the input. */
  label: string;
  /** Whether the operator must fill it before the connector can be added. */
  required: boolean;
  /** Secret fields (passwords / keys) are masked in the UI and never echoed. */
  secret?: boolean;
  /** Placeholder / example shown in the input — a hint, never auto-used. */
  placeholder?: string;
}

// ─── ConnectorType — one curated data-source type ─────────────────────────────────────────────────
export interface ConnectorType {
  /** Stable id, used as the catalog key + prefilled connector name slug. */
  id: string;
  /** Human name shown in the catalog card. */
  name: string;
  category: ConnectorCategory;
  /** The string stored on the connector row (`createConnector({type})`) + read by detectDialect. */
  connectorType: string;
  /** Plain-language "what it is / when to use it" — for the non-technical operator. */
  description: string;
  /** The auth SHAPE the add form collects. */
  authKind: AuthKind;
  /** A sample endpoint / DSN the operator adapts — NOT auto-used. */
  endpointHint: string;
  /** The inputs the add form prefills/collects for this type. */
  fields: ConnectorField[];
  /**
   * TRUE when connector-exec.ts:detectDialect() can open a LIVE connection to this type (postgres /
   * mysql / mssql / rest-http) — so sync + the data-domains rule engine actually read rows. FALSE
   * when the type is stored as directory/binding METADATA only (no live-query path yet). Honest by
   * design: the UI must not imply a metadata-only source will stream rows.
   */
  liveQuery: boolean;
}

// The endpoint field every type needs — a small helper so each entry stays readable.
function endpointField(label: string, placeholder: string, required = true): ConnectorField {
  return { key: 'endpoint', label, required, placeholder };
}

// ─── THE CATALOG — curated, real connector types grouped by category ──────────────────────────────
export const CONNECTOR_TYPES: ConnectorType[] = [
  // ── Relational DB (LIVE-QUERYABLE where detectDialect matches) ────────────────────────────────────
  {
    id: 'postgres',
    name: 'PostgreSQL',
    category: 'Relational DB',
    connectorType: 'postgres',
    description:
      'Connect to a PostgreSQL database — the most common open-source relational store. Ask questions of its tables, and bind it into a data domain for grounded answers.',
    authKind: 'password',
    endpointHint: 'postgres://user:password@host:5432/database',
    fields: [
      endpointField('Connection string (DSN)', 'postgres://user:password@host:5432/database'),
    ],
    liveQuery: true,
  },
  {
    id: 'mysql',
    name: 'MySQL',
    category: 'Relational DB',
    connectorType: 'mysql',
    description:
      'Connect to a MySQL / MariaDB database. Read its tables and bind it into a data domain the same way as Postgres.',
    authKind: 'password',
    endpointHint: 'mysql://user:password@host:3306/database',
    fields: [endpointField('Connection string (DSN)', 'mysql://user:password@host:3306/database')],
    liveQuery: true,
  },
  {
    id: 'mssql',
    name: 'Microsoft SQL Server',
    category: 'Relational DB',
    connectorType: 'mssql',
    description:
      'Connect to a Microsoft SQL Server (or Azure SQL) database — common for enterprise ERP/finance systems. Reads tables for grounded answers.',
    authKind: 'password',
    endpointHint: 'mssql://user:password@host:1433/database',
    fields: [endpointField('Connection string (DSN)', 'mssql://user:password@host:1433/database')],
    liveQuery: true,
  },
  {
    id: 'oracle',
    name: 'Oracle Database',
    category: 'Relational DB',
    connectorType: 'oracle',
    description:
      'Register an Oracle Database source. Stored in the connector directory and bindable; live querying is not wired yet — it appears as a catalogued source.',
    authKind: 'password',
    endpointHint: 'oracle://user:password@host:1521/service',
    fields: [endpointField('Connection string (DSN)', 'oracle://user:password@host:1521/service')],
    liveQuery: false,
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    category: 'Relational DB',
    connectorType: 'sqlite',
    description:
      'Register a file-based SQLite database. Lightweight and local; catalogued in the directory (live querying is not wired for SQLite yet).',
    authKind: 'none',
    endpointHint: 'file:/data/app.db',
    fields: [endpointField('Database file path', 'file:/data/app.db')],
    liveQuery: false,
  },

  // ── Warehouse (metadata-only today — no live-query dialect) ───────────────────────────────────────
  {
    id: 'snowflake',
    name: 'Snowflake',
    category: 'Warehouse',
    connectorType: 'snowflake',
    description:
      'Register a Snowflake cloud data warehouse. Catalogued as a data source; live querying through the console is not wired yet.',
    authKind: 'password',
    endpointHint: 'snowflake://user:password@account/database/schema?warehouse=WH',
    fields: [
      endpointField('Account / connection URI', 'snowflake://user:password@account/db/schema'),
    ],
    liveQuery: false,
  },
  {
    id: 'bigquery',
    name: 'Google BigQuery',
    category: 'Warehouse',
    connectorType: 'bigquery',
    description:
      'Register a Google BigQuery dataset. Catalogued as a data source; live querying through the console is not wired yet.',
    authKind: 'api-key',
    endpointHint: 'bigquery://project/dataset',
    fields: [
      endpointField('Project / dataset', 'bigquery://project/dataset'),
      { key: 'apiKey', label: 'Service-account key (JSON)', required: false, secret: true },
    ],
    liveQuery: false,
  },
  {
    id: 'databricks',
    name: 'Databricks',
    category: 'Warehouse',
    connectorType: 'databricks',
    description:
      'Register a Databricks SQL warehouse / lakehouse. Catalogued as a data source; live querying through the console is not wired yet.',
    authKind: 'api-key',
    endpointHint: 'https://<workspace>.cloud.databricks.com/sql/1.0/warehouses/<id>',
    fields: [
      endpointField('SQL warehouse HTTP path / host', 'https://<workspace>.databricks.com/...'),
      { key: 'apiKey', label: 'Access token', required: false, secret: true },
    ],
    liveQuery: false,
  },

  // ── Object store ──────────────────────────────────────────────────────────────────────────────────
  {
    id: 's3',
    name: 'Amazon S3',
    category: 'Object store',
    connectorType: 's3',
    description:
      'Browse and manage approved S3 objects through a governed bucket and folder binding.',
    authKind: 's3-keys',
    endpointHint: 'https://s3.amazonaws.com',
    fields: [
      endpointField('Service endpoint', 'https://s3.amazonaws.com'),
      { key: 'accessKey', label: 'Access key ID', required: true, secret: true },
      { key: 'secretKey', label: 'Secret access key', required: true, secret: true },
    ],
    liveQuery: false,
  },
  {
    id: 'minio',
    name: 'MinIO (S3-compatible)',
    category: 'Object store',
    connectorType: 's3',
    description:
      'Browse and manage approved MinIO objects through the same governed S3-compatible path.',
    authKind: 's3-keys',
    endpointHint: 'http://minio.internal:9000',
    fields: [
      endpointField('Service endpoint', 'http://minio.internal:9000'),
      { key: 'accessKey', label: 'Access key', required: true, secret: true },
      { key: 'secretKey', label: 'Secret key', required: true, secret: true },
    ],
    liveQuery: false,
  },

  // ── Streaming (metadata-only today) ───────────────────────────────────────────────────────────────
  {
    id: 'kafka',
    name: 'Apache Kafka',
    category: 'Streaming',
    connectorType: 'kafka',
    description:
      'Register an Apache Kafka (or Redpanda) event stream — upstream events and change feeds. Catalogued as a data source; stream consumption is not wired through the console yet.',
    authKind: 'none',
    endpointHint: 'kafka://broker.internal:9092',
    fields: [
      endpointField('Bootstrap broker(s)', 'kafka://broker.internal:9092'),
      { key: 'topic', label: 'Topic', required: false, placeholder: 'events' },
    ],
    liveQuery: false,
  },

  // ── SaaS / REST (rest/http IS live-queryable via detectDialect) ───────────────────────────────────
  {
    id: 'rest',
    name: 'REST / HTTP API',
    category: 'SaaS/REST',
    connectorType: 'rest',
    description:
      'Connect to any REST/HTTP JSON API — an internal service or a json-server style source. Live-queryable: the console reads the endpoint and can bind resources into a data domain.',
    authKind: 'api-key',
    endpointHint: 'https://api.internal/v1',
    fields: [
      endpointField('Base URL', 'https://api.internal/v1'),
      { key: 'apiKey', label: 'API key (if required)', required: false, secret: true },
    ],
    liveQuery: true,
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'SaaS/REST',
    connectorType: 'rest',
    description:
      'Connect to Salesforce (or a Salesforce-style CRM REST API) — accounts, opportunities, contacts. Live-queryable as a REST source once you point at its API endpoint.',
    authKind: 'oauth',
    endpointHint: 'https://your-instance.my.salesforce.com/services/data/v60.0',
    fields: [
      endpointField(
        'Instance API URL',
        'https://your-instance.my.salesforce.com/services/data/v60.0',
      ),
    ],
    liveQuery: true,
  },
  {
    id: 'gsheets',
    name: 'Google Sheets',
    category: 'SaaS/REST',
    connectorType: 'rest',
    description:
      'Connect to a Google Sheet published as a JSON/CSV endpoint, or a Sheets API URL. Live-queryable as a REST source; rows are read from the endpoint you supply.',
    authKind: 'api-key',
    endpointHint: 'https://sheets.googleapis.com/v4/spreadsheets/<id>/values/<range>',
    fields: [
      endpointField('Sheet endpoint URL', 'https://sheets.googleapis.com/v4/spreadsheets/<id>/...'),
      { key: 'apiKey', label: 'API key', required: false, secret: true },
    ],
    liveQuery: true,
  },

  // ── NoSQL (metadata-only today) ───────────────────────────────────────────────────────────────────
  {
    id: 'mongodb',
    name: 'MongoDB',
    category: 'NoSQL',
    connectorType: 'mongodb',
    description:
      'Register a MongoDB document database. Catalogued in the directory as a data source; live querying through the console is not wired yet.',
    authKind: 'password',
    endpointHint: 'mongodb://user:password@host:27017/database',
    fields: [endpointField('Connection string', 'mongodb://user:password@host:27017/database')],
    liveQuery: false,
  },
  {
    id: 'redis',
    name: 'Redis',
    category: 'NoSQL',
    connectorType: 'redis',
    description:
      'Register a Redis key-value / cache store. Catalogued as a data source; live querying through the console is not wired yet.',
    authKind: 'password',
    endpointHint: 'redis://:password@host:6379',
    fields: [endpointField('Connection string', 'redis://:password@host:6379')],
    liveQuery: false,
  },
  {
    id: 'elasticsearch',
    name: 'Elasticsearch',
    category: 'NoSQL',
    connectorType: 'elasticsearch',
    description:
      'Register an Elasticsearch / OpenSearch index for search and analytics. Catalogued as a data source; live querying through the console is not wired yet.',
    authKind: 'api-key',
    endpointHint: 'https://es.internal:9200/index',
    fields: [
      endpointField('Cluster URL + index', 'https://es.internal:9200/index'),
      { key: 'apiKey', label: 'API key', required: false, secret: true },
    ],
    liveQuery: false,
  },
];

// ─── Lookup + grouping helpers (PURE) ─────────────────────────────────────────────────────────────
export function getConnectorType(id: string): ConnectorType | null {
  return CONNECTOR_TYPES.find((c) => c.id === id) ?? null;
}

export interface ConnectorCategoryGroup {
  category: ConnectorCategory;
  types: ConnectorType[];
}

// Group the catalog by category, in the canonical category order. Empty categories are dropped so
// the browse UI never renders an empty heading.
export function connectorCatalogByCategory(
  types: ConnectorType[] = CONNECTOR_TYPES,
): ConnectorCategoryGroup[] {
  return CONNECTOR_CATEGORIES.map((category) => ({
    category,
    types: types.filter((t) => t.category === category),
  })).filter((g) => g.types.length > 0);
}

// Every type the exec layer can LIVE-QUERY (postgres/mysql/mssql/rest) — the ones that actually read
// rows for sync + the data-domains rule engine. The rest are directory metadata only.
export function liveQueryableTypes(types: ConnectorType[] = CONNECTOR_TYPES): ConnectorType[] {
  return types.filter((t) => t.liveQuery);
}

// ─── Search + category filter (PURE) ──────────────────────────────────────────────────────────────
// The browse UI's filter: a free-text query (matched against name / description / connectorType /
// category) AND an optional category. Both are ANDed. Empty query + null category → the full set.
export function filterConnectorCatalog(
  types: ConnectorType[],
  query: string,
  category: ConnectorCategory | null,
): ConnectorType[] {
  const q = query.trim().toLowerCase();
  return types.filter((t) => {
    if (category && t.category !== category) return false;
    if (!q) return true;
    return (
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.connectorType.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    );
  });
}

// ─── isAddable — the PURE add gating rule ─────────────────────────────────────────────────────────
// A catalog entry can be turned into a connector ONLY when the operator has supplied a real,
// non-empty endpoint (the catalog's endpointHint is a SAMPLE, never auto-used) AND a name. The
// console never guesses where a source lives.
export function isBlankEndpoint(endpoint: string | undefined | null): boolean {
  return !endpoint || endpoint.trim().length === 0;
}

export function isAddable(
  type: ConnectorType | null,
  values: { name: string; endpoint: string },
): boolean {
  if (!type) return false;
  if (!values.name || values.name.trim().length === 0) return false;
  return !isBlankEndpoint(values.endpoint);
}

// ─── Auth normalization ───────────────────────────────────────────────────────────────────────────
// The connector-create route accepts ONLY `none | api-key | oauth`. The catalog's data-plane auth
// kinds (`password`, `s3-keys`) are collected in the form but must be narrowed to a route-accepted
// value before POST. password/s3-keys → 'api-key' (a credential is carried); everything else maps
// 1:1. This keeps the stored `auth` column honest AND route-valid.
const ROUTE_AUTHS = new Set(['none', 'api-key', 'oauth']);
export function toStoredAuth(authKind: AuthKind): 'none' | 'api-key' | 'oauth' {
  if (ROUTE_AUTHS.has(authKind)) return authKind as 'none' | 'api-key' | 'oauth';
  // password + s3-keys both mean "a credential is supplied" → api-key is the closest route value.
  return 'api-key';
}

// ─── buildAddPayload — the PURE connector-create payload builder ──────────────────────────────────
// Turns a catalog entry + the operator's field values into EXACTLY the body the EXISTING connector-
// create route expects (POST /api/v1/admin/connectors → createConnector):
// {name, type, endpoint, auth, description}. type is the catalog's connectorType; auth is narrowed
// to a route-accepted value. The description carries the catalog description plus an honest
// live-query / metadata-only posture marker so the stored connector reflects what it can actually do.
// Secret field values are NEVER embedded in the stored payload — they belong in a secret store; here
// the endpoint carries the DSN (which may include a password inline, as the exec layer expects) but
// standalone secret keys are not stored on the row. The endpoint is trimmed.
export interface ConnectorAddPayload {
  name: string;
  type: string;
  endpoint: string;
  auth: 'none' | 'api-key' | 'oauth';
  description: string;
}

export function buildAddPayload(
  type: ConnectorType,
  values: { name: string; endpoint: string },
): ConnectorAddPayload {
  const postureMarker = type.liveQuery ? '[live-query]' : '[metadata-only]';
  return {
    name: values.name.trim(),
    type: type.connectorType,
    endpoint: values.endpoint.trim(),
    auth: toStoredAuth(type.authKind),
    description: `${postureMarker} ${type.description}`,
  };
}
