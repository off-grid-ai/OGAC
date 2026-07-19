// The declared surface of everything configurable in this deployment. The global
// Config module renders from this — grouped, typed, with secret masking — so admins
// can see and edit every env-backed setting from the UI instead of SSHing to the box.
//
// Effective value at runtime = .env.local on the server (what the app loads) ??
// process default. Edits are written back to .env.local and applied on restart.

import { toConnectHost, toDisplayHost } from '@/lib/display-host';

export type ConfigType = 'string' | 'number' | 'boolean' | 'url';

export interface ConfigKeyDef {
  key: string;
  group: string;
  label: string;
  type: ConfigType;
  secret: boolean;
  /** True if changing it needs a restart (all env-backed keys do, today). */
  restartRequired: boolean;
  description: string;
  /**
   * Suggested default shown (as a placeholder) when the key is unset. Founder directive:
   * defaults are ALWAYS the mDNS form (offgrid-s1.local, …) — never a raw IP/loopback.
   */
  default?: string;
  /**
   * True when this value carries a connection host we must never leak as a raw IP/loopback.
   * Such values are rendered through `toDisplayHost` (mDNS) for display and mapped back on
   * save via `toConnectHost`, so what the operator SEES is mDNS while the real connect target
   * is unchanged. Covers `url` types plus host-bearing strings (Redis, Temporal address, …).
   */
  hostValue?: boolean;
  /** True for comma-separated host[:port] values such as Kafka bootstrap broker lists. */
  hostListValue?: boolean;
}

type HostConfigValue = Pick<ConfigKeyDef, 'hostValue' | 'hostListValue'>;

function mapHostConfigValue(
  def: HostConfigValue,
  value: string,
  mapHost: (input: string) => string,
): string {
  if (def.hostListValue) {
    return value
      .split(',')
      .map((entry) => mapHost(entry.trim()))
      .join(',');
  }
  return def.hostValue ? mapHost(value) : value;
}

/**
 * Pure display mapping for a config value: host-bearing values render in their mDNS form
 * (never a raw IP/loopback). Everything else is returned as-is. Zero-IO — safe to unit-test
 * and to call from a client component. `def` may be looked up by key via CONFIG_REGISTRY.
 */
export function configDisplayValue(def: HostConfigValue, value: string): string {
  if (!value) return value;
  return mapHostConfigValue(def, value, toDisplayHost);
}

/**
 * Inverse of `configDisplayValue` for the SAVE path: a value the operator edited in mDNS form
 * is mapped back to the real connect target before it's persisted, so connectivity is
 * unchanged. Non-host values pass through. Pure, zero-IO.
 */
export function configConnectValue(def: HostConfigValue, value: string): string {
  if (!value) return value;
  return mapHostConfigValue(def, value, toConnectHost);
}

export const CONFIG_REGISTRY: ConfigKeyDef[] = [
  // ── AI Gateway ──
  {
    key: 'OFFGRID_GATEWAY_URL',
    group: 'AI Gateway',
    label: 'Legacy gateway URL',
    type: 'url',
    secret: false,
    restartRequired: true,
    hostValue: true,
    default: 'http://offgrid-s1.local:4000', // NOSONAR -- private fleet mDNS; this internal service has no TLS listener.
    description:
      'Backwards-compatible default for both inference and control until their explicit URLs are set.',
  },
  {
    key: 'OFFGRID_GATEWAY_API_KEY',
    group: 'AI Gateway',
    label: 'Gateway API key',
    type: 'string',
    secret: true,
    restartRequired: true,
    description:
      'Backwards-compatible static x-api-key for the aggregator control and legacy inference door.',
  },
  {
    key: 'OFFGRID_GATEWAY_CONTROL_URL',
    group: 'AI Gateway',
    label: 'Gateway control URL',
    type: 'url',
    secret: false,
    restartRequired: true,
    hostValue: true,
    description:
      'Aggregator inventory and node-control endpoint; independent from the model inference door.',
  },
  {
    key: 'OFFGRID_GATEWAY_CONTROL_API_KEY',
    group: 'AI Gateway',
    label: 'Gateway control API key',
    type: 'string',
    secret: true,
    restartRequired: true,
    description: 'Optional dedicated x-api-key for aggregator inventory and node control.',
  },
  {
    key: 'OFFGRID_INFERENCE_PROVIDER',
    group: 'AI Gateway',
    label: 'Inference provider',
    type: 'string',
    secret: false,
    restartRequired: true,
    description:
      'Set to litellm for an explicit LiteLLM model-door cutover; unset preserves legacy gateway behavior.',
  },
  {
    key: 'OFFGRID_INFERENCE_URL',
    group: 'AI Gateway',
    label: 'Inference URL',
    type: 'url',
    secret: false,
    restartRequired: true,
    hostValue: true,
    description:
      'Optional explicit OpenAI-compatible model door. Does not affect node-control calls.',
  },
  {
    key: 'OFFGRID_INFERENCE_API_KEY',
    group: 'AI Gateway',
    label: 'Inference API key',
    type: 'string',
    secret: true,
    restartRequired: true,
    description:
      'Bearer credential for an explicit inference door; LiteLLM otherwise uses its master key.',
  },
  {
    key: 'OFFGRID_LITELLM_URL',
    group: 'AI Gateway',
    label: 'LiteLLM URL',
    type: 'url',
    secret: false,
    restartRequired: true,
    hostValue: true,
    description: 'LiteLLM management URL and model door when OFFGRID_INFERENCE_PROVIDER=litellm.',
  },
  {
    key: 'OFFGRID_LITELLM_MASTER_KEY',
    group: 'AI Gateway',
    label: 'LiteLLM master key',
    type: 'string',
    secret: true,
    restartRequired: true,
    description: 'Bearer credential for LiteLLM inference and management APIs.',
  },

  // ── Database ──
  {
    key: 'DATABASE_URL',
    group: 'Database',
    label: 'Postgres URL',
    type: 'string',
    secret: true,
    restartRequired: true,
    description: 'Console state + audit + chat. postgres://user:pass@host:5432/db',
  },

  // ── Auth ──
  {
    key: 'AUTH_SECRET',
    group: 'Auth',
    label: 'Auth secret',
    type: 'string',
    secret: true,
    restartRequired: true,
    description: 'NextAuth signing secret.',
  },
  {
    key: 'AUTH_DEV_LOGIN',
    group: 'Auth',
    label: 'Dev login',
    type: 'boolean',
    secret: false,
    restartRequired: true,
    description: 'Enable the dev credentials login. MUST be false in production.',
  },
  {
    key: 'OFFGRID_ADMIN_EMAILS',
    group: 'Auth',
    label: 'Admin emails',
    type: 'string',
    secret: false,
    restartRequired: true,
    description: 'Comma-separated emails always granted admin, regardless of Keycloak role.',
  },
  {
    key: 'AUTH_KEYCLOAK_ID',
    group: 'Auth',
    label: 'Keycloak client ID',
    type: 'string',
    secret: false,
    restartRequired: true,
    description: 'OIDC client for console SSO.',
  },
  {
    key: 'AUTH_KEYCLOAK_SECRET',
    group: 'Auth',
    label: 'Keycloak client secret',
    type: 'string',
    secret: true,
    restartRequired: true,
    description: 'OIDC client secret.',
  },
  {
    key: 'AUTH_KEYCLOAK_ISSUER',
    group: 'Auth',
    label: 'Keycloak issuer',
    type: 'url',
    secret: false,
    restartRequired: true,
    hostValue: true,
    description: 'Realm URL, e.g. https://kc/realms/offgrid',
  },

  // ── Keycloak admin (Access module) ──
  {
    key: 'OFFGRID_KEYCLOAK_URL',
    group: 'Keycloak admin',
    label: 'Keycloak base URL',
    type: 'url',
    secret: false,
    restartRequired: true,
    hostValue: true,
    default: 'http://offgrid-s1.local:8080', // NOSONAR -- private fleet mDNS; this internal service has no TLS listener.
    description: 'Admin API base for user/client management.',
  },
  {
    key: 'OFFGRID_KEYCLOAK_REALM',
    group: 'Keycloak admin',
    label: 'Realm',
    type: 'string',
    secret: false,
    restartRequired: true,
    description: 'Realm name.',
  },
  {
    key: 'OFFGRID_KEYCLOAK_CLIENT_ID',
    group: 'Keycloak admin',
    label: 'Admin client ID',
    type: 'string',
    secret: false,
    restartRequired: true,
    description: 'Service-account client for realm-management.',
  },
  {
    key: 'OFFGRID_KEYCLOAK_CLIENT_SECRET',
    group: 'Keycloak admin',
    label: 'Admin client secret',
    type: 'string',
    secret: true,
    restartRequired: true,
    description: 'Service-account client secret.',
  },

  // ── Services ──
  {
    key: 'OFFGRID_QDRANT_URL',
    group: 'Services',
    label: 'Qdrant URL',
    type: 'url',
    secret: false,
    restartRequired: true,
    hostValue: true,
    default: 'http://offgrid-s1.local:6333', // NOSONAR -- private fleet mDNS; this internal service has no TLS listener.
    description: 'Vector store for Brain/RAG.',
  },
  {
    key: 'OFFGRID_OPENSEARCH_URL',
    group: 'Services',
    label: 'OpenSearch URL',
    type: 'url',
    secret: false,
    restartRequired: true,
    hostValue: true,
    default: 'http://offgrid-s1.local:9200', // NOSONAR -- private fleet mDNS; this internal service has no TLS listener.
    description: 'SIEM / gateway analytics / logs.',
  },
  {
    key: 'OFFGRID_LANGFUSE_URL',
    group: 'Services',
    label: 'Langfuse URL',
    type: 'url',
    secret: false,
    restartRequired: true,
    hostValue: true,
    default: 'http://offgrid-g6.local:8931', // NOSONAR -- private fleet mDNS; this internal service has no TLS listener.
    description: 'LLM observability.',
  },
  {
    key: 'OFFGRID_LANGFUSE_AUTH',
    group: 'Services',
    label: 'Langfuse auth',
    type: 'string',
    secret: true,
    restartRequired: true,
    description: 'Base64 basic-auth for Langfuse API.',
  },
  {
    key: 'OFFGRID_UNLEASH_URL',
    group: 'Services',
    label: 'Unleash URL',
    type: 'url',
    secret: false,
    restartRequired: true,
    hostValue: true,
    default: 'http://offgrid-g6.local:8932', // NOSONAR -- private fleet mDNS; this internal service has no TLS listener.
    description: 'Feature flags.',
  },
  {
    key: 'OFFGRID_UNLEASH_ADMIN_TOKEN',
    group: 'Services',
    label: 'Unleash admin token',
    type: 'string',
    secret: true,
    restartRequired: true,
    description: 'Admin API token — required to manage flags/variants/rollout from the console.',
  },
  {
    key: 'OFFGRID_UNLEASH_ENV',
    group: 'Services',
    label: 'Unleash environment',
    type: 'string',
    secret: false,
    restartRequired: true,
    description: 'Environment the console reads/writes (development|production).',
  },
  {
    key: 'OFFGRID_UNLEASH_PROJECT',
    group: 'Services',
    label: 'Unleash project',
    type: 'string',
    secret: false,
    restartRequired: true,
    description: 'Unleash project the console manages (default: default).',
  },
  {
    key: 'OFFGRID_REDIS_URL',
    group: 'Services',
    label: 'Redis URL',
    type: 'string',
    secret: false,
    restartRequired: true,
    hostValue: true,
    default: 'redis://offgrid-s1.local:6379',
    description:
      'Cache adapter backend. Optional — the cache falls back to an in-process store when unset/unreachable.',
  },
  {
    key: 'OFFGRID_TEMPORAL_ADDRESS',
    group: 'Services',
    label: 'Temporal address',
    type: 'string',
    secret: false,
    restartRequired: true,
    hostValue: true,
    default: 'offgrid-s1.local:7233',
    description: 'Durable workflow engine (agents queue).',
  },
  {
    key: 'OFFGRID_PROVIT_URL',
    group: 'Services',
    label: 'Provit URL',
    type: 'url',
    secret: false,
    restartRequired: true,
    hostValue: true,
    description: 'Prove It (visual QA) product surface.',
  },
  {
    key: 'OFFGRID_PRESIDIO_ANALYZER_URL',
    group: 'Services',
    label: 'Presidio analyzer URL',
    type: 'url',
    secret: false,
    restartRequired: true,
    hostValue: true,
    description:
      'Data-movement PII detection endpoint. OFFGRID_PRESIDIO_URL remains a backwards-compatible alias.',
  },
  {
    key: 'OFFGRID_PRESIDIO_ANONYMIZER_URL',
    group: 'Services',
    label: 'Presidio anonymizer URL',
    type: 'url',
    secret: false,
    restartRequired: true,
    hostValue: true,
    description:
      'Data-movement PII anonymization endpoint. Content guardrails remain owned by LLM Guard.',
  },
  {
    key: 'OFFGRID_OTEL_URL',
    group: 'Services',
    label: 'OTel collector URL',
    type: 'url',
    secret: false,
    restartRequired: true,
    hostValue: true,
    description:
      'Canonical OTLP/HTTP collector base URL. OFFGRID_OTLP_URL remains a backwards-compatible alias.',
  },
  {
    key: 'OFFGRID_REDPANDA_ADMIN_URL',
    group: 'Services',
    label: 'Redpanda Admin API URL',
    type: 'url',
    secret: false,
    restartRequired: true,
    hostValue: true,
    default: 'http://offgrid-s1.local:8943', // NOSONAR -- private fleet mDNS; this internal service has no TLS listener.
    description:
      'Cluster health and broker inspection through the Console host edge boundary. Override this deployment contract in the server environment when topology changes.',
  },
  {
    key: 'OFFGRID_REDPANDA_SCHEMA_URL',
    group: 'Services',
    label: 'Redpanda Schema Registry URL',
    type: 'url',
    secret: false,
    restartRequired: true,
    hostValue: true,
    default: 'http://offgrid-s1.local:8946', // NOSONAR -- private fleet mDNS; this internal service has no TLS listener.
    description:
      'Schema Registry through the Console host edge boundary. Override this deployment contract in the server environment when topology changes.',
  },
  {
    key: 'OFFGRID_REDPANDA_BROKERS',
    group: 'Services',
    label: 'Redpanda Kafka bootstrap brokers',
    type: 'string',
    secret: false,
    restartRequired: true,
    hostListValue: true,
    description:
      'Comma-separated Kafka bootstrap endpoints used by native topic, produce, consume, and proof actions. No default is assumed: broker metadata must be reachable from the Console host.',
  },
  {
    key: 'OFFGRID_REDPANDA_CLIENT_ID',
    group: 'Services',
    label: 'Redpanda Kafka client ID',
    type: 'string',
    secret: false,
    restartRequired: true,
    default: 'offgrid-console',
    description: 'Kafka client identity emitted by Console-native Redpanda operations.',
  },
  {
    key: 'OFFGRID_REDPANDA_REST_URL',
    group: 'Services',
    label: 'Redpanda REST Proxy URL',
    type: 'url',
    secret: false,
    restartRequired: true,
    hostValue: true,
    description:
      'Optional Pandaproxy HTTP boundary for representative produce and consumer operations.',
  },

  // ── Adapters ──
  {
    key: 'OFFGRID_ADAPTER_CACHING',
    group: 'Adapters',
    label: 'Caching adapter',
    type: 'string',
    secret: false,
    restartRequired: true,
    description: 'e.g. redis | memory',
  },
  {
    key: 'OFFGRID_ADAPTER_FLAGS',
    group: 'Adapters',
    label: 'Flags adapter',
    type: 'string',
    secret: false,
    restartRequired: true,
    description: 'e.g. unleash | env',
  },
  {
    key: 'OFFGRID_ADAPTER_PROVENANCE',
    group: 'Adapters',
    label: 'Provenance adapter',
    type: 'string',
    secret: false,
    restartRequired: true,
    description: 'e.g. ed25519 | none',
  },
  {
    key: 'OFFGRID_ADAPTER_SANDBOX',
    group: 'Adapters',
    label: 'Sandbox adapter',
    type: 'string',
    secret: false,
    restartRequired: true,
    description: 'Code-exec isolation: docker | firecracker',
  },
  {
    key: 'OFFGRID_ADAPTER_DATA_REDACTION',
    group: 'Adapters',
    label: 'Data redaction adapter',
    type: 'string',
    secret: false,
    restartRequired: true,
    description:
      'Row/data anonymization only: presidio | regex. Does not change LLM Guard content policy.',
  },

  // ── Platform ──
  {
    key: 'OFFGRID_ADMIN_TOKEN',
    group: 'Platform',
    label: 'Admin API token',
    type: 'string',
    secret: true,
    restartRequired: true,
    description: 'Break-glass static bearer for the admin API (CI/bootstrap).',
  },
  {
    key: 'NEXT_PUBLIC_OFFGRID_MODULES',
    group: 'Platform',
    label: 'Enabled modules',
    type: 'string',
    secret: false,
    restartRequired: true,
    description: 'Comma-separated module IDs. Empty = all enabled.',
  },
];
