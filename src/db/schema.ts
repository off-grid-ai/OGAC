import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

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
  orgId: text('org_id').notNull().default('default'),
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
  orgId: text('org_id').notNull().default('default'),
  name: text('name').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull().default('connected'),
  lastSync: timestamp('last_sync', { withTimezone: true }),
  // ─── Custom-connector fields (additive) — populated when an admin registers a connector via the
  // Integrations directory. `endpoint` is the MCP server URL or HTTP endpoint; `auth` is the scheme.
  endpoint: text('endpoint').notNull().default(''),
  auth: text('auth').notNull().default('none'), // none | api-key | oauth
  description: text('description').notNull().default(''),
  custom: boolean('custom').notNull().default(false), // admin-registered vs seeded/built-in
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
  orgId: text('org_id').notNull().default('default'),
  kind: text('kind').notNull(),
  action: text('action').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const datasets = pgTable('datasets', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
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
  orgId: text('org_id').notNull().default('default'),
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
  orgId: text('org_id').notNull().default('default'),
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
  orgId: text('org_id').notNull().default('default'),
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
  orgId: text('org_id').notNull().default('default'),
  name: text('name').notNull(),
  type: text('type').notNull().default('http'), // 'http' | 'mcp'
  endpoint: text('endpoint').notNull().default(''),
  description: text('description').notNull().default(''), // when-to-use, for intent matching
  enabled: boolean('enabled').notNull().default(true),
  // Per-connector action policy — 'allow' (run immediately) | 'approval' (human gate) | 'blocked'
  // (refuse). Enforced in chat-tools.ts execution; admin-editable in the connector directory.
  policy: text('policy').notNull().default('approval'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Org-wide settings — single-row store (id='org') for the highest-precedence system prompt
// injected into EVERY chat (before per-user custom instructions), plus other org-scoped toggles.
export const orgSettings = pgTable('org_settings', {
  id: text('id').primaryKey().default('org'), // singleton row
  systemPrompt: text('system_prompt').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by').notNull().default(''),
});

// ─── Custom roles — operator-defined roles layered on the built-in RBAC/ABAC. `capabilities` is
// the set of granted module ids the role may access; `basedOn` names a built-in role it inherits.
export const customRoles = pgTable('custom_roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  basedOn: text('based_on').notNull().default('viewer'), // inherits a built-in role's baseline
  capabilities: jsonb('capabilities').$type<string[]>().notNull().default([]), // granted module ids
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
  // Sharing scope: private (only the owner) | org (shared with members below). Additive.
  visibility: text('visibility').notNull().default('private'), // private | org
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Project sharing — grant named users view/edit access to a project they don't own. RBAC-aware:
// only the owner (or an admin) manages the member list. Additive to chat_projects.
export const chatProjectMembers = pgTable(
  'chat_project_members',
  {
    projectId: text('project_id').notNull(),
    userId: text('user_id').notNull(), // member's email
    canEdit: boolean('can_edit').notNull().default(false), // false = view only
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (m) => [primaryKey({ columns: [m.projectId, m.userId] })],
);

// Per-project memory — a project-scoped memory space (parallel to per-user chat_memory). Facts
// captured while chatting under a project, injected into that project's future chats. Additive.
export const chatProjectMemory = pgTable('chat_project_memory', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  fact: text('fact').notNull(),
  source: text('source').notNull().default('chat'), // chat | manual
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const chatConversations = pgTable('chat_conversations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  projectId: text('project_id'), // null = ad-hoc chat
  skillId: text('skill_id'), // optional org skill bound to this conversation
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
  // ─── Edit & branch (Wave 2) — a parent-pointer tree over messages ───
  // parentId points at the message this one follows (null = a root turn). Editing a user turn
  // inserts a sibling under the same parent; `active` marks which sibling is on the shown path.
  // The linear transcript is the walk from roots choosing the active child at each step.
  parentId: text('parent_id'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Org skills — reusable assistants (instructions + model + optional knowledge project), published
// org-wide and RBAC-scoped per role (allowedRoles empty = everyone). Invoked in chat via a picker;
// the skill's system prompt is injected for that conversation. Admin-managed.
export const chatSkills = pgTable('chat_skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  systemPrompt: text('system_prompt').notNull().default(''),
  model: text('model').notNull().default(''),
  projectId: text('project_id'), // optional knowledgebase to ground the skill
  allowedRoles: jsonb('allowed_roles').$type<string[]>().notNull().default([]),
  icon: text('icon'),
  enabled: boolean('enabled').notNull().default(true),
  createdBy: text('created_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // ─── Assistant builder (GPT-parity) fields — all additive ───
  // Clickable prompt suggestions shown when a fresh chat opens under this skill.
  conversationStarters: jsonb('conversation_starters').$type<string[]>().notNull().default([]),
  // Capability toggles the assistant may use (web browsing, tool-calling, code execution).
  capabilities: jsonb('capabilities')
    .$type<{ web?: boolean; tools?: boolean; code?: boolean }>()
    .notNull()
    .default({}),
  // Optional OpenAPI schema (raw text) declaring an Action; a simple executor registers it as a
  // callable tool for the assistant at chat time.
  actionsSchema: text('actions_schema').notNull().default(''),
  // Sharing scope: private (only the creator) | org (visible to allowedRoles / everyone).
  visibility: text('visibility').notNull().default('org'), // private | org
});

// Prompt library — a personal/org library of reusable prompt texts (distinct from skills, which are
// assistants). Org-visible prompts are shared with everyone; private prompts only with the owner.
// Variables are the {{placeholder}} tokens extracted from the content for templating.
export const promptLibrary = pgTable('prompt_library', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default('Untitled prompt'),
  content: text('content').notNull().default(''),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  variables: jsonb('variables').$type<string[]>().notNull().default([]),
  owner: text('owner').notNull().default(''),
  visibility: text('visibility').notNull().default('private'), // private | org
  uses: integer('uses').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Per-user custom instructions (like ChatGPT's) — injected as the first system message.
export const chatSettings = pgTable('chat_settings', {
  userId: text('user_id').primaryKey(),
  customInstructions: text('custom_instructions').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Per-user cross-conversation memory — salient facts extracted from chats, injected into the
// system prompt of future chats (like ChatGPT memory). User-manageable (view/delete). Additive.
export const chatMemory = pgTable('chat_memory', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  fact: text('fact').notNull(),
  source: text('source').notNull().default('chat'), // chat | manual
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

// ─── Organization-wide knowledge base — admin-curated shared corpus, indexed once via the
// gateway's embeddings, retrieved permission-aware (a user only sees collections their role
// permits). Parallel to the per-project chat RAG tables above. See lib/org-knowledge.ts.
export const orgKnowledgeCollections = pgTable('org_knowledge_collections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  // allowedRoles empty = every authenticated user may retrieve; otherwise role must be listed.
  allowedRoles: jsonb('allowed_roles').$type<string[]>().notNull().default([]),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orgKnowledgeDocs = pgTable('org_knowledge_docs', {
  id: text('id').primaryKey(),
  collectionId: text('collection_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('text'),
  size: integer('size').notNull().default(0),
  // The original uploaded file lives in SeaweedFS (the single file-storage layer); these hold
  // the reference so the user can view/download exactly what they uploaded. Null for docs added
  // as raw text (no source file). fileUrl points at the gateway's SeaweedFS path.
  fileUrl: text('file_url'),
  mime: text('mime'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orgKnowledgeChunks = pgTable('org_knowledge_chunks', {
  id: text('id').primaryKey(),
  docId: text('doc_id').notNull(),
  collectionId: text('collection_id').notNull(),
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

// ─── Gateway runtime config (admin-editable env vars, persisted + pushed live) ─
// Each row is one env-var-equivalent setting. `secret` rows have their value
// masked in GET responses. `liveReload` marks settings the gateway can apply
// without a restart (via POST /config). Others take effect on next gateway start.
export const gatewayConfig = pgTable('gateway_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull().default(''),
  description: text('description').notNull().default(''),
  secret: boolean('secret').notNull().default(false),
  liveReload: boolean('live_reload').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by').notNull().default(''),
});

// ─── Gateway client tokens (enterprise token passthrough + IP mapping) ────────
// Written by the console's /api/gateway/tokens sync route, which reads the
// in-memory TokenStore from the running gateway. One row per distinct token
// (stored as a non-reversible fingerprint — the raw value is never persisted).
// `ips` tracks every source IP that used the token with per-IP use counts.
// `meta` is a free-form operator-controlled blob: routing overrides, labels,
// tenant attribution, rate-limit tiers, or any other annotations.
// `routingOverrides` is the structured part of meta the gateway actually acts on:
// when a request arrives from a source IP listed here, the gateway substitutes
// the mapped target IP/node before routing. Conditions are defined per-entry and
// evaluated by the client-auth policy's routing hook (conditions TBD by operator).
export const gatewayClientTokens = pgTable('gateway_client_tokens', {
  // FNV-1a fingerprint of the raw token (hex, 8 chars) — deterministic dedup key.
  fingerprint: text('fingerprint').primaryKey(),
  // Short display preview, e.g. "sk-ant-…abc4". Never the full value.
  preview: text('preview').notNull(),
  kind: text('kind').notNull().default('bearer'), // bearer | x-api-key
  // Best-effort inferred provider/type from token shape (Anthropic, OpenAI, JWT, …).
  inferred: jsonb('inferred').$type<{
    provider?: string;
    tokenType?: string;
    jwt?: { header: Record<string, unknown>; payload: Record<string, unknown> };
    notes?: string;
  }>().notNull().default({}),
  // Map of { [ip]: useCount } — all distinct source IPs seen with this token.
  ips: jsonb('ips').$type<Record<string, number>>().notNull().default({}),
  // Operator-defined routing overrides: when a request arrives from `sourceIp`,
  // route it as if it came from `targetIp` (or target a specific named node).
  // The exact match/condition logic is supplied later; the shape is fixed here.
  routingOverrides: jsonb('routing_overrides').$type<{
    sourceIp: string;
    targetIp?: string;
    targetNode?: string;
    note?: string;
  }[]>().notNull().default([]),
  // Free-form operator metadata: tenant id, labels, rate-limit tier, etc.
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  uses: integer('uses').notNull().default(0),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Chat artifacts library (ChatGPT/Claude "Artifacts" surface) ──────────────
// Append-only: saved artifacts detected in chat replies, promoted to a top-level library so a
// user can revisit generated HTML/SVG/React/code/text without scrolling the thread. Client saves
// on open via /api/v1/chat/artifacts.
export const chatArtifacts = pgTable('chat_artifacts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  kind: text('kind').notNull(), // html | svg | mermaid | react | text | code
  // Body lives in SeaweedFS (the single file-storage layer) at codeKey; codeHash is the sha256
  // used for save-dedupe without fetching bytes. `code` is legacy: kept nullable as a read
  // fallback for rows written before the migration; new writes leave it empty.
  code: text('code').default(''),
  codeKey: text('code_key'),
  codeHash: text('code_hash'),
  language: text('language'), // python | node for runnable code
  title: text('title').notNull().default('Untitled artifact'),
  conversationId: text('conversation_id'),
  // Publish/share (Wave 1): when published an artifact is readable at /artifacts/[id]/view.
  // Org-scoped by default via orgId; published flips it to a stable read-only surface.
  orgId: text('org_id'),
  published: boolean('published').notNull().default(false),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  // Points at the current (latest) version row so the library shows head content.
  currentVersion: integer('current_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Chat artifact versions (Wave 1: history + revert) ────────────────────────
// Every re-save of the same (user, conversation, title) appends a version here rather than
// dropping as a dedupe. The parent chat_artifacts row tracks currentVersion; revert copies an
// old version forward as a new head version.
export const chatArtifactVersions = pgTable(
  'chat_artifact_versions',
  {
    id: text('id').primaryKey(),
    artifactId: text('artifact_id').notNull(),
    version: integer('version').notNull(),
    kind: text('kind').notNull(),
    // Body in SeaweedFS at codeKey (codeHash = sha256); `code` legacy read-fallback, see above.
    code: text('code').default(''),
    codeKey: text('code_key'),
    codeHash: text('code_hash'),
    language: text('language'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (v) => [index('chat_artifact_versions_idx').on(v.artifactId, v.version)],
);

// ─── Per-user chat preferences (Settings modal: capabilities, appearance) ─────
// Append-only sibling of chat_settings so custom instructions stay untouched. `prefs` holds the
// Capabilities/Appearance toggles (memory, code execution, search, theme) as free-form JSON.
export const chatPrefs = pgTable('chat_prefs', {
  userId: text('user_id').primaryKey(),
  prefs: jsonb('prefs').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Studio templates (saved workflows) ───────────────────────────────────────
export const studioTemplates = pgTable('studio_templates', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  prompt: text('prompt').notNull(),
  workflow: jsonb('workflow').notNull(),
  visibility: text('visibility').notNull().default('private'), // 'private' | 'org' | 'public'
  // Deployed-app slug (S2): when published, the app is served at /app/<slug>.
  slug: text('slug'),
  published: boolean('published').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Config audit (global config service — who changed which env key when) ─────
export const configAudit = pgTable('config_audit', {
  id: text('id').primaryKey(),
  key: text('key').notNull(),
  actor: text('actor').notNull(),
  // Old/new values are redacted for secrets before insert (never store raw secrets here).
  oldValue: text('old_value'),
  newValue: text('new_value'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Config settings (global config service — admin overrides, materialized to env on restart) ──
export const configSettings = pgTable('config_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
