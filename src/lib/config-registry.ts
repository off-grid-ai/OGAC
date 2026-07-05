// The declared surface of everything configurable in this deployment. The global
// Config module renders from this — grouped, typed, with secret masking — so admins
// can see and edit every env-backed setting from the UI instead of SSHing to the box.
//
// Effective value at runtime = .env.local on the server (what the app loads) ??
// process default. Edits are written back to .env.local and applied on restart.

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
}

export const CONFIG_REGISTRY: ConfigKeyDef[] = [
  // ── AI Gateway ──
  { key: 'OFFGRID_GATEWAY_URL', group: 'AI Gateway', label: 'Gateway URL', type: 'url', secret: false, restartRequired: true, description: 'The OpenAI-compatible aggregator the console calls for all inference.' },
  { key: 'OFFGRID_GATEWAY_API_KEY', group: 'AI Gateway', label: 'Gateway API key', type: 'string', secret: true, restartRequired: true, description: 'Static key sent as x-api-key to the aggregator. Must match the aggregator plist.' },

  // ── Database ──
  { key: 'DATABASE_URL', group: 'Database', label: 'Postgres URL', type: 'string', secret: true, restartRequired: true, description: 'Console state + audit + chat. postgres://user:pass@host:5432/db' },

  // ── Auth ──
  { key: 'AUTH_SECRET', group: 'Auth', label: 'Auth secret', type: 'string', secret: true, restartRequired: true, description: 'NextAuth signing secret.' },
  { key: 'AUTH_DEV_LOGIN', group: 'Auth', label: 'Dev login', type: 'boolean', secret: false, restartRequired: true, description: 'Enable the dev credentials login. MUST be false in production.' },
  { key: 'OFFGRID_ADMIN_EMAILS', group: 'Auth', label: 'Admin emails', type: 'string', secret: false, restartRequired: true, description: 'Comma-separated emails always granted admin, regardless of Keycloak role.' },
  { key: 'AUTH_KEYCLOAK_ID', group: 'Auth', label: 'Keycloak client ID', type: 'string', secret: false, restartRequired: true, description: 'OIDC client for console SSO.' },
  { key: 'AUTH_KEYCLOAK_SECRET', group: 'Auth', label: 'Keycloak client secret', type: 'string', secret: true, restartRequired: true, description: 'OIDC client secret.' },
  { key: 'AUTH_KEYCLOAK_ISSUER', group: 'Auth', label: 'Keycloak issuer', type: 'url', secret: false, restartRequired: true, description: 'Realm URL, e.g. https://kc/realms/offgrid' },

  // ── Keycloak admin (Access module) ──
  { key: 'OFFGRID_KEYCLOAK_URL', group: 'Keycloak admin', label: 'Keycloak base URL', type: 'url', secret: false, restartRequired: true, description: 'Admin API base for user/client management.' },
  { key: 'OFFGRID_KEYCLOAK_REALM', group: 'Keycloak admin', label: 'Realm', type: 'string', secret: false, restartRequired: true, description: 'Realm name.' },
  { key: 'OFFGRID_KEYCLOAK_CLIENT_ID', group: 'Keycloak admin', label: 'Admin client ID', type: 'string', secret: false, restartRequired: true, description: 'Service-account client for realm-management.' },
  { key: 'OFFGRID_KEYCLOAK_CLIENT_SECRET', group: 'Keycloak admin', label: 'Admin client secret', type: 'string', secret: true, restartRequired: true, description: 'Service-account client secret.' },

  // ── Services ──
  { key: 'OFFGRID_QDRANT_URL', group: 'Services', label: 'Qdrant URL', type: 'url', secret: false, restartRequired: true, description: 'Vector store for Brain/RAG.' },
  { key: 'OFFGRID_OPENSEARCH_URL', group: 'Services', label: 'OpenSearch URL', type: 'url', secret: false, restartRequired: true, description: 'SIEM / gateway analytics / logs.' },
  { key: 'OFFGRID_LANGFUSE_URL', group: 'Services', label: 'Langfuse URL', type: 'url', secret: false, restartRequired: true, description: 'LLM observability.' },
  { key: 'OFFGRID_LANGFUSE_AUTH', group: 'Services', label: 'Langfuse auth', type: 'string', secret: true, restartRequired: true, description: 'Base64 basic-auth for Langfuse API.' },
  { key: 'OFFGRID_UNLEASH_URL', group: 'Services', label: 'Unleash URL', type: 'url', secret: false, restartRequired: true, description: 'Feature flags.' },
  { key: 'OFFGRID_UNLEASH_ADMIN_TOKEN', group: 'Services', label: 'Unleash admin token', type: 'string', secret: true, restartRequired: true, description: 'Admin API token — required to manage flags/variants/rollout from the console.' },
  { key: 'OFFGRID_UNLEASH_ENV', group: 'Services', label: 'Unleash environment', type: 'string', secret: false, restartRequired: true, description: 'Environment the console reads/writes (development|production).' },
  { key: 'OFFGRID_UNLEASH_PROJECT', group: 'Services', label: 'Unleash project', type: 'string', secret: false, restartRequired: true, description: 'Unleash project the console manages (default: default).' },
  { key: 'OFFGRID_REDIS_URL', group: 'Services', label: 'Redis URL', type: 'string', secret: false, restartRequired: true, description: 'Cache adapter backend.' },
  { key: 'OFFGRID_TEMPORAL_ADDRESS', group: 'Services', label: 'Temporal address', type: 'string', secret: false, restartRequired: true, description: 'Durable workflow engine (agents queue).' },
  { key: 'OFFGRID_PROVIT_URL', group: 'Services', label: 'Provit URL', type: 'url', secret: false, restartRequired: true, description: 'Prove It (visual QA) product surface.' },

  // ── Adapters ──
  { key: 'OFFGRID_ADAPTER_CACHING', group: 'Adapters', label: 'Caching adapter', type: 'string', secret: false, restartRequired: true, description: 'e.g. redis | memory' },
  { key: 'OFFGRID_ADAPTER_FLAGS', group: 'Adapters', label: 'Flags adapter', type: 'string', secret: false, restartRequired: true, description: 'e.g. unleash | env' },
  { key: 'OFFGRID_ADAPTER_PROVENANCE', group: 'Adapters', label: 'Provenance adapter', type: 'string', secret: false, restartRequired: true, description: 'e.g. ed25519 | none' },
  { key: 'OFFGRID_ADAPTER_SANDBOX', group: 'Adapters', label: 'Sandbox adapter', type: 'string', secret: false, restartRequired: true, description: 'Code-exec isolation: docker | firecracker' },

  // ── Platform ──
  { key: 'OFFGRID_ADMIN_TOKEN', group: 'Platform', label: 'Admin API token', type: 'string', secret: true, restartRequired: true, description: 'Break-glass static bearer for the admin API (CI/bootstrap).' },
  { key: 'NEXT_PUBLIC_OFFGRID_MODULES', group: 'Platform', label: 'Enabled modules', type: 'string', secret: false, restartRequired: true, description: 'Comma-separated module IDs. Empty = all enabled.' },
];
