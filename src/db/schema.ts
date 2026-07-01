import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

// ─── Fleet / control-plane tables ────────────────────────────────────────────
export const devices = pgTable('devices', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  os: text('os').notNull(),
  role: text('role').notNull(),
  status: text('status').notNull().default('offline'),
  lastSeen: text('last_seen').notNull().default('never'),
  policyVersion: integer('policy_version').notNull().default(0),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
});

// Append-only policy versions; the current policy is the highest version.
export const policies = pgTable('policies', {
  version: integer('version').primaryKey(),
  egressAllowed: boolean('egress_allowed').notNull().default(false),
  guardrails: jsonb('guardrails').$type<string[]>().notNull(),
  allowedModels: jsonb('allowed_models').$type<string[]>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull(),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  model: text('model').notNull(),
  tokens: integer('tokens').notNull().default(0),
  leftDevice: boolean('left_device').notNull().default(false),
  tool: text('tool'),
  outcome: text('outcome').notNull(),
  latencyMs: integer('latency_ms').notNull().default(0),
  checks: jsonb('checks').$type<{ name: string; verdict: string; score?: number; ms?: number }[]>(),
  keyId: text('key_id'), // virtual key this call was billed to (FinOps attribution)
});

// ─── FinOps: virtual keys (token issuance) — scoped to a user or project, with a budget ───
export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(), // display token prefix, e.g. ogk_ab12…
  subjectType: text('subject_type').notNull().default('user'), // user | project
  subject: text('subject').notNull(),
  budgetUsd: integer('budget_usd'), // monthly budget in whole USD; null = unlimited
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enrollmentTokens = pgTable('enrollment_tokens', {
  token: text('token').primaryKey(),
  role: text('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  used: boolean('used').notNull().default(false),
});

export const commands = pgTable('commands', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull(),
  type: text('type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  consumed: boolean('consumed').notNull().default(false),
});

// ─── Data plane (M3) ──────────────────────────────────────────────────────────
export const connectors = pgTable('connectors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull().default('connected'),
  lastSync: timestamp('last_sync', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ingestJobs = pgTable('ingest_jobs', {
  id: text('id').primaryKey(),
  connectorId: text('connector_id').notNull(),
  connectorName: text('connector_name').notNull(),
  status: text('status').notNull().default('queued'),
  records: integer('records').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
});

export const maskingRules = pgTable('masking_rules', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  action: text('action').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const datasets = pgTable('datasets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  source: text('source').notNull(),
  rows: integer('rows').notNull().default(0),
  classification: text('classification').notNull().default('internal'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Evals + golden sets ──────────────────────────────────────────────────────
export const goldenCases = pgTable('golden_cases', {
  id: text('id').primaryKey(),
  query: text('query').notNull(),
  expected: text('expected').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const evalRuns = pgTable('eval_runs', {
  id: text('id').primaryKey(),
  score: integer('score').notNull().default(0),
  total: integer('total').notNull().default(0),
  passed: integer('passed').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  results:
    jsonb('results').$type<
      { query: string; expected: string; pass: boolean; top: string; score: number }[]
    >(),
});

// ─── Multi-tenant + ABAC (#10) ────────────────────────────────────────────────
export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  plan: text('plan').notNull().default('standard'),
  enabledModules: jsonb('enabled_modules').$type<string[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const abacRules = pgTable('abac_rules', {
  id: text('id').primaryKey(),
  role: text('role').notNull(),
  attribute: text('attribute').notNull(),
  operator: text('operator').notNull(),
  value: text('value').notNull(),
  resource: text('resource').notNull(),
  effect: text('effect').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Feature flags (runtime toggles; the flags capability's first-party store) ────
export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  description: text('description').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Prompt registry (templates + versioning) ─────────────────────────────────
export const prompts = pgTable('prompts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  latestVersion: integer('latest_version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const promptVersions = pgTable('prompt_versions', {
  id: text('id').primaryKey(),
  promptId: text('prompt_id').notNull(),
  version: integer('version').notNull(),
  body: text('body').notNull(),
  label: text('label').notNull().default(''), // e.g. production | staging
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Governance registry (Phase E org wrapper: policies, committees, processes) ──
// The org/regulatory placards that are functions/processes, not tools — tracked as attestable
// records (AI-use policy, ethics board, RACI, training, vendor, insurance, tabletop drills).
export const governanceItems = pgTable('governance_items', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(), // policy | ethics_review | raci | training | vendor | insurance | drill | impact_assessment
  title: text('title').notNull(),
  owner: text('owner').notNull().default(''),
  status: text('status').notNull().default('draft'), // draft | active | due | expired
  detail: text('detail').notNull().default(''),
  reviewedAt: text('reviewed_at').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Agent run traces (handoffs + provenance + citations) ─────────────────────
// A run is a multi-step trace: plan → retrieve → handoff → ground → answer. Each step records
// the sources it touched (provenance); the final answer carries the grounded citation set.
export const agentRuns = pgTable('agent_runs', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  query: text('query').notNull(),
  answer: text('answer').notNull().default(''),
  status: text('status').notNull().default('done'),
  steps:
    jsonb('steps').$type<
      { kind: string; label: string; detail: string; refs: string[]; ms: number }[]
    >(),
  citations:
    jsonb('citations').$type<
      { ref: string; title: string; snippet: string; score: number; supported: boolean }[]
    >(),
  // Guardrail/eval check results (pre + post) and the detached provenance signature over the
  // answer — both produced in-path by the interaction pipeline.
  checks:
    jsonb('checks').$type<
      { name: string; verdict: string; score?: number; ms?: number; detail?: string }[]
    >(),
  provenance:
    jsonb('provenance').$type<{
      signature: string;
      algorithm: string;
      publicKey: string | null;
      signedAt: string;
    }>(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Model routing rules (smart + conditional routing / cloud leash) ──────────
// Evaluated by ascending priority; first match decides where a request runs. Folded into the
// policy bundle the node pulls, so the gateway enforces it as the chokepoint.
export const routingRules = pgTable('routing_rules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  priority: integer('priority').notNull().default(100),
  attribute: text('attribute').notNull(), // data_class | task | cost | region | …
  operator: text('operator').notNull(), // eq | neq | in
  value: text('value').notNull(),
  action: text('action').notNull(), // local | cloud | block
  model: text('model').notNull().default(''), // target model (optional)
  fallback: text('fallback').notNull().default(''), // fallback model on unavailability
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── User-authored agents (created from text in the console) ──────────────────
// Custom agents declared by an operator in plain language. They carry no special powers: every
// run flows through the SAME governed pipeline as the built-ins (policy gate → guardrails →
// retrieval/routing → grounding → provenance), so an agent authored here inherits every
// convention configured on the console. `systemPrompt` is the natural-language instruction that
// steers composition; `model` ('' = gateway default + routing rules decide).
export const customAgents = pgTable('custom_agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role').notNull().default('Custom'),
  description: text('description').notNull().default(''),
  systemPrompt: text('system_prompt').notNull().default(''),
  model: text('model').notNull().default(''),
  tools: jsonb('tools').$type<string[]>().notNull().default([]),
  grounded: boolean('grounded').notNull().default(true),
  trigger: text('trigger').notNull().default('on-demand'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Tool registry (router's `tool` source / MCP & HTTP invocations) ──────────
export const tools = pgTable('tools', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull().default('http'), // 'http' | 'mcp'
  endpoint: text('endpoint').notNull().default(''),
  description: text('description').notNull().default(''), // when-to-use, for intent matching
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Auth.js tables (Drizzle adapter) + RBAC role on the user ─────────────────
export const users = pgTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image: text('image'),
  role: text('role').notNull().default('viewer'),
});

// ─── Chat workspace (end-user "your own ChatGPT" — ports desktop projects/threads/messages) ──
// Mirrors Off Grid AI Desktop's RAG store: a project is a container with a system prompt; a
// conversation is a thread; messages carry role/content (+ optional images as data URIs and
// reasoning). Backed by the on-prem gateways for inference — zero per-seat AI cost.
export const chatProjects = pgTable('chat_projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  systemPrompt: text('system_prompt').notNull().default(''),
  icon: text('icon'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const chatConversations = pgTable('chat_conversations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  projectId: text('project_id'), // null = ad-hoc chat
  title: text('title').notNull().default('New chat'),
  model: text('model').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  role: text('role').notNull(), // user | assistant | system
  content: text('content').notNull().default(''),
  reasoning: text('reasoning'), // model thinking, kept separate from content
  images: jsonb('images').$type<string[]>(), // data: URIs sent with a user turn
  citations: jsonb('citations').$type<{ name: string; position: number; score: number }[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Knowledgebase for a project — documents + embedded chunks (RAG). Mirrors desktop rag_documents
// / rag_chunks; embeddings via the gateway's /v1/embeddings (384-dim), retrieved at chat time.
export const chatDocuments = pgTable('chat_documents', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('text'),
  size: integer('size').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const chatChunks = pgTable('chat_chunks', {
  id: text('id').primaryKey(),
  docId: text('doc_id').notNull(),
  projectId: text('project_id').notNull(),
  content: text('content').notNull(),
  position: integer('position').notNull().default(0),
  embedding: jsonb('embedding').$type<number[]>(),
});

export const accounts = pgTable(
  'account',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })],
);

export const sessions = pgTable('session', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_token',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);
