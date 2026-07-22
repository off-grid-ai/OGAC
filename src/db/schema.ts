import { sql } from 'drizzle-orm';
import { boolean, doublePrecision, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// ─── Fleet / control-plane tables ────────────────────────────────────────────
export const devices = pgTable('devices', {
  id: text('id').primaryKey(),
  // Tenant scope: a device belongs to the org it was enrolled under. Without this, listDevices was
  // global and device kill/command/role routes reached ANY tenant's device by id — a destructive
  // cross-tenant IDOR (P0). Defaults to 'default' so pre-hardening rows/backfill are safe; set from
  // the enrolling admin's org on enroll (self-migrated via ensureOrgSchema).
  orgId: text('org_id').notNull().default('default'),
  name: text('name').notNull(),
  os: text('os').notNull(),
  role: text('role').notNull(),
  status: text('status').notNull().default('offline'),
  lastSeen: text('last_seen').notNull().default('never'),
  policyVersion: integer('policy_version').notNull().default(0),
  // Per-device data-plane secret, minted at enrollment and presented as a Bearer by the node on
  // every /devices/[id]/{audit,policy,commands} call. Random (not the predictable dt_<id>). Nullable:
  // devices enrolled before this hardening carry no token and fall back to the legacy dt_<id> form
  // until they re-enroll (see src/lib/device-token.ts).
  token: text('token'),
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
  // Tenant scope (v1 audit stream). Without it, /api/v1/audit + listAudit returned EVERY tenant's
  // device/gateway audit trail — compliance-fatal cross-tenant leak (P0). Inherited from the
  // device's org on append; defaults to 'default' for pre-hardening rows. Self-migrated via
  // ensureOrgSchema. (The canonical v2 stream `audit_events_v2` already carries `org`.)
  orgId: text('org_id').notNull().default('default'),
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
  prefix: text('prefix').notNull(), // display token prefix, e.g. ogak_ab12…
  subjectType: text('subject_type').notNull().default('user'), // user | project
  subject: text('subject').notNull(),
  budgetUsd: integer('budget_usd'), // monthly budget in whole USD; null = unlimited
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enrollmentTokens = pgTable('enrollment_tokens', {
  token: text('token').primaryKey(),
  role: text('role').notNull(),
  // Tenant scope: the org an enrolling node lands in. Set from the issuing admin's org so a device
  // enrolled with this token is stamped into the right tenant. Defaults to 'default'. Self-migrated.
  orgId: text('org_id').notNull().default('default'),
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
  // OpenBao KV key path (NOT a value) naming this connector's credential (DB password / api key).
  // Additive + nullable: legacy/seeded connectors have none and fall back to inline endpoint creds;
  // connectors created via the UI store their password in the vault and reference it here — the
  // endpoint stays credential-free. Resolved at query time by connector-exec.ts. See connector-secrets.ts.
  secretRef: text('secret_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ingestJobs = pgTable('ingest_jobs', {
  id: text('id').primaryKey(),
  // Tenant scope: jobs belong to their connector's org. Without this, listIngestJobs was global —
  // a cross-tenant leak of ingest metadata (P1). Defaults to 'default' so pre-existing rows/backfill
  // are safe, and set explicitly from the connector's orgId on insert.
  orgId: text('org_id').notNull().default('default'),
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
  // The pipeline (app) this golden case belongs to. NULL = an org-wide/shared case (the reusable
  // library). A pipeline's golden set = its own cases; runs execute in that pipeline's context.
  appId: text('app_id'),
  // The PIPELINE this golden case belongs to (corrected 3-tier model — governance lives on the
  // pipeline). NULL = an org-wide/shared case (the reusable library). Supersedes app_id as the
  // governance owner; app_id is kept for the already-shipped app Quality tab back-compat.
  pipelineId: text('pipeline_id'),
  orgId: text('org_id').notNull().default('default'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const evalRuns = pgTable('eval_runs', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  // PA-12 — the pipeline this run executed in the CONTEXT of (the eval def's pipeline binding), so
  // Drift (which reads eval-run history) can be per-pipeline EXACT. NULL = an org-wide/library run
  // not bound to any pipeline (unchanged behaviour). eval_definitions/golden_cases already carry
  // pipeline_id; this closes the loop by tagging the RUN at the source.
  pipelineId: text('pipeline_id'),
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
  // URL-safe handle for the tenant's own subdomain (<slug>.onprem-console.getoffgridai.co).
  // Nullable + unique: legacy rows have none; postgres allows multiple NULLs under a unique index.
  slug: text('slug').unique(),
  plan: text('plan').notNull().default('standard'),
  enabledModules: jsonb('enabled_modules').$type<string[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const abacRules = pgTable('abac_rules', {
  id: text('id').primaryKey(),
  // Tenant scope: ABAC rules are per-org policy. Without it every tenant's rules were evaluated
  // together (evaluateAbac read the global set) — a cross-tenant policy leak. Defaults to 'default'
  // for pre-hardening rows; set from the caller's org on create. Self-migrated via ensureOrgSchema.
  orgId: text('org_id').notNull().default('default'),
  role: text('role').notNull(),
  attribute: text('attribute').notNull(),
  operator: text('operator').notNull(),
  value: text('value').notNull(),
  resource: text('resource').notNull(),
  effect: text('effect').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Feature flags (runtime toggles; the flags capability's first-party store) ────
// Tenant-scoped: a flag is per-org, so one tenant toggling a capability never flips it for another.
// The key alone was the PK (global) — a cross-tenant config leak; the identity is now (org_id, key),
// so the same key coexists per org. Reads/writes default to DEFAULT_ORG (single-tenant unchanged).
// Self-migrated via ensureOrgSchema (adds org_id + rebuilds the PK to the composite).
export const featureFlags = pgTable(
  'feature_flags',
  {
    orgId: text('org_id').notNull().default('default'),
    key: text('key').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    description: text('description').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.key] })],
);

// ─── Prompt registry (templates + versioning) ─────────────────────────────────
export const prompts = pgTable('prompts', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
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
  orgId: text('org_id').notNull().default('default'),
  // Runtime agents materialized from an App inline step have one canonical owner. The self-migration
  // adds the composite FK (owner_app_id, org_id) → apps(id, org_id) with ON DELETE CASCADE.
  ownerAppId: text('owner_app_id'),
  // An agent is an independent consumer: null means deliberately unbound. It never inherits the
  // org's chat default (see agent-pipeline-policy.ts).
  pipelineId: text('pipeline_id'),
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
  // ─── Governed chat binding (CONSUMERS-BIND #166) ───────────────────────────
  // Admin sets the org-default chat pipeline + the SET of pipelines a user may pick per-project.
  // Users pick ONLY from the allowlist; no ungoverned binding. Most-specific-wins resolution:
  // org default → per-project override (chat_projects.pipeline_id) → per-message model.
  defaultChatPipelineId: text('default_chat_pipeline_id'),
  chatPipelineAllowlist: jsonb('chat_pipeline_allowlist').$type<string[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by').notNull().default(''),
});

// ─── Custom roles — operator-defined roles layered on the built-in RBAC/ABAC. `capabilities` is
// the set of granted module ids the role may access; `basedOn` names a built-in role it inherits.
export const customRoles = pgTable('custom_roles', {
  id: text('id').primaryKey(),
  // Tenant scope: operator-defined roles are per-org. Without org_id listCustomRoles returned every
  // tenant's roles and getCustomRoleByName could resolve another org's role — a cross-tenant RBAC
  // leak. Defaults to 'default'; set from the caller's org on create. Self-migrated via ensureOrgSchema.
  orgId: text('org_id').notNull().default('default'),
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
  // The org this user belongs to (tenant membership). Drives currentOrgId: a user is scoped to
  // THEIR org; only a platform admin may cross into another tenant (e.g. via its subdomain). Legacy
  // rows default to the single 'default' org.
  orgId: text('org_id').notNull().default('default'),
});

// ─── Chat workspace (end-user "your own ChatGPT" — ports desktop projects/threads/messages) ──
// Mirrors Off Grid AI Desktop's RAG store: a project is a container with a system prompt; a
// conversation is a thread; messages carry role/content (+ optional images as data URIs and
// reasoning). Backed by the on-prem gateways for inference — zero per-seat AI cost.
export const chatProjects = pgTable('chat_projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  // Host-bound tenant scope (currentOrgId) — a project belongs to the org the user was in when
  // they created it, so Workspace projects are tenant-isolated. Defaults to 'default' for pre-tenant rows.
  orgId: text('org_id').notNull().default('default'),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  systemPrompt: text('system_prompt').notNull().default(''),
  icon: text('icon'),
  // Sharing scope: private (only the owner) | org (shared with members below). Additive.
  visibility: text('visibility').notNull().default('private'), // private | org
  // Per-project pipeline override (CONSUMERS-BIND #166). null ⇒ inherit the org-default chat
  // pipeline. A user may only set this to a pipeline in org_settings.chat_pipeline_allowlist.
  pipelineId: text('pipeline_id'),
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
  // Host-bound tenant scope (currentOrgId) — the org the user was in when the conversation was
  // created, so Workspace chat is tenant-isolated (a user on tenant A's subdomain never sees
  // tenant B's chats). Defaults to 'default' for pre-tenant rows.
  orgId: text('org_id').notNull().default('default'),
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
  // Tenant scope: org skills are published org-wide within ITS org. Without org_id a skill was
  // visible to every tenant's chat picker. Defaults to 'default'; set from the creator's org.
  // Self-migrated via ensureOrgSchema.
  orgId: text('org_id').notNull().default('default'),
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
  // Tenant scope: an org-visible library prompt is shared within ITS org only. Without org_id an
  // 'org' prompt leaked to every tenant. Defaults to 'default'; set from the owner's org on create.
  // Self-migrated via ensureOrgSchema.
  orgId: text('org_id').notNull().default('default'),
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

// Prompt partials — reusable prompt FRAGMENTS composed into full prompts. A prompt references a
// partial by name with a Handlebars-style `{{>partial-name}}` token; the renderer inlines the
// fragment's body in place (see src/lib/prompt-template.ts). `name` is the unique reference key
// (slugged, per owner+visibility). Same private|org visibility model as the prompt library so a shared
// partial composes into every org member's prompts. Table is created idempotently on first use
// (ensurePromptPartialSchema) — no migration step on the SSH deploy path.
export const promptPartials = pgTable('prompt_partials', {
  id: text('id').primaryKey(),
  // Tenant scope: an org-visible partial composes into ITS org members' prompts only. Without
  // org_id a shared partial leaked across tenants. Defaults to 'default'; set from the owner's org
  // on create. Self-migrated via ensureOrgSchema.
  orgId: text('org_id').notNull().default('default'),
  name: text('name').notNull(), // reference key used in {{>name}}
  title: text('title').notNull().default(''),
  content: text('content').notNull().default(''),
  owner: text('owner').notNull().default(''),
  visibility: text('visibility').notNull().default('private'), // private | org
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
  // Tenant scope: per-user memory is bound to the org the user was in when it was captured, so a
  // user on tenant A's subdomain never has tenant B's facts injected. Defaults to 'default'.
  // Self-migrated via ensureOrgSchema.
  orgId: text('org_id').notNull().default('default'),
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
  orgId: text('org_id').notNull().default('default'),
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
  // Tenant scope (Wave 2): every artifact is bound to the org it was saved in, so a user on
  // tenant A's subdomain never sees tenant B's library. Defaults to 'default'; NOT NULL so the
  // read filter is total. Self-migrated (backfilled from NULL) via ensureChatSchema.
  orgId: text('org_id').notNull().default('default'),
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

// ─── Provit (visual QA) — data pushed from Provit so every repo / feature map / run / verdict
//     is first-class + searchable in the console (roadmap Phase 2). Provit authenticates with a
//     service-account JWT (same seam as the gateway). ──────────────────────────────────────────
// Tenancy: every row carries org_id (team) + owner_id (user) + visibility. The no-login /try
// demo pushes visibility='public' (the PUBLIC LIBRARY, visible to all); authenticated team runs
// push visibility='org' scoped to their org, or 'private' for owner-only. RBAC gates the module;
// ABAC (abac_rules, resource='provit') refines per-attribute.
export const provitRepos = pgTable('provit_repos', {
  id: text('id').primaryKey(),                 // owner-repo slug
  orgId: text('org_id').notNull().default('default'),
  ownerId: text('owner_id').notNull().default(''),
  visibility: text('visibility').notNull().default('public'), // 'private' | 'org' | 'public'
  url: text('url').notNull(),                  // canonical github url
  features: integer('features').notNull().default(0),
  testFiles: integer('test_files').notNull().default(0),
  screens: integer('screens').notNull().default(0),
  cases: integer('cases').notNull().default(0),
  plan: jsonb('plan'),                         // full feature map incl. per-feature test cases
  mappedBy: text('mapped_by'),                 // principal (email / client id)
  mappedAt: timestamp('mapped_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ orgIdx: index('provit_repos_org_idx').on(t.orgId), visIdx: index('provit_repos_vis_idx').on(t.visibility) }));

export const provitRuns = pgTable('provit_runs', {
  id: text('id').primaryKey(),                 // run id
  orgId: text('org_id').notNull().default('default'),
  ownerId: text('owner_id').notNull().default(''),
  visibility: text('visibility').notNull().default('public'), // 'private' | 'org' | 'public'
  repoId: text('repo_id'),                     // provit_repos.id (nullable — some runs are ad-hoc)
  surface: text('surface'),                    // web | desktop | ios | android
  model: text('model'),
  direction: text('direction'),               // on-track | partial | off-track | unknown
  headline: text('headline'),
  frames: integer('frames').notNull().default(0),
  flagged: integer('flagged').notNull().default(0),
  video: text('video'),
  narrative: text('narrative'),
  payload: jsonb('payload'),                   // full run record
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ repoIdx: index('provit_runs_repo_idx').on(t.repoId), orgIdx: index('provit_runs_org_idx').on(t.orgId) }));

// Integration tokens: a user mints one in the console (bound to their org + identity), gives it
// to their Provit instance, and Provit's pushes are attributed to that org (visibility='org').
// Only the SHA-256 hash is stored; the plaintext is shown once at creation.
export const provitTokens = pgTable('provit_tokens', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  orgId: text('org_id').notNull().default('default'),
  ownerId: text('owner_id').notNull(),         // user email who issued it
  label: text('label').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revoked: boolean('revoked').notNull().default(false),
}, (t) => ({ hashIdx: index('provit_tokens_hash_idx').on(t.tokenHash) }));

// Merged output of the judge API — one row per judged frame-batch (window).
export const provitVerdicts = pgTable('provit_verdicts', {
  id: text('id').primaryKey(),                 // `${runId}:${idx}`
  runId: text('run_id').notNull(),
  idx: integer('idx').notNull(),
  frameRange: text('frame_range'),             // e.g. "10-14"
  bad: boolean('bad').notNull().default(false),
  note: text('note'),
}, (t) => ({ runIdx: index('provit_verdicts_run_idx').on(t.runId) }));

// ─── Unified App model (Builder Epic #108) — the one "app" entity ─────────────
// AppSpec supersedes customAgent + studioTemplate as the single build artifact: an app is a
// triggered, multi-step workflow. A simple agent is just an app with one agent step. ADDITIVE:
// customAgents/studioTemplates are NOT dropped — a Phase-1A compat shim maps old templates to
// AppSpec so /app/<slug> keeps working. Org-scoped + timestamped like the other build tables.
//   trigger   — TriggerSpec: how the app is invoked (on-demand | schedule | webhook | email | …).
//   inputForm — optional FormField[] collected before the run (null = no form).
//   steps     — AppStep[]: agent | connector-query | guardrail | human | output nodes.
//   edges     — {from,to,when?}[]: the directed graph wiring steps together.
export const apps = pgTable('apps', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  visibility: text('visibility').notNull().default('private'), // 'private' | 'org' | 'public'
  // The GOVERNED pipeline this app/agent runs on (CONSUMERS-BIND #166). null ⇒ resolve to the org
  // default at run time. Every run resolves + is tagged with the bound pipeline (pipeline:<id>) so
  // policy/guardrails/telemetry lenses light up. Set on the "Runs on" selector in the builder.
  pipelineId: text('pipeline_id'),
  // Deployed-app slug: when published, the app is served at /app/<slug>.
  slug: text('slug'),
  published: boolean('published').notNull().default(false),
  // How the app is triggered — TriggerSpec envelope, shape owned by lib/triggers.ts (Phase 2B).
  trigger: jsonb('trigger')
    .$type<{ kind: string; config?: Record<string, unknown> }>()
    .notNull()
    .default({ kind: 'on-demand' }),
  // Optional input form collected before the run starts (null = no form).
  inputForm: jsonb('input_form').$type<
    { id: string; label: string; type: string; required?: boolean; options?: string[] }[]
  >(),
  // The workflow steps. Shape owned by lib/app-model.ts (Phase 1A); jsonb here keeps it flexible.
  steps: jsonb('steps')
    .$type<{ id: string; kind: string; label: string; config: Record<string, unknown> }[]>()
    .notNull()
    .default([]),
  // Directed edges wiring steps; `when` is an optional guard expression on the transition.
  edges: jsonb('edges')
    .$type<{ from: string; to: string; when?: string }[]>()
    .notNull()
    .default([]),
  // SOP / template reuse (#TEMPLATE-REUSE): when this app is published as a reusable org/public
  // TEMPLATE, `isTemplate` is true and `templateVars` carries the declared {{var}} schema another
  // team fills in on adoption. Shape owned by lib/app-template-vars.ts (TemplateVarSchema).
  isTemplate: boolean('is_template').notNull().default(false),
  templateVars: jsonb('template_vars').$type<{
    vars: {
      name: string;
      type: string;
      description?: string;
      default?: string;
      required?: boolean;
      options?: string[];
    }[];
  } | null>(),
  // Provenance for a cloned/adopted app — where it descends from (lib/app-clone.ts AppLineage).
  // null ⇒ authored from scratch. Never affects governance; it makes duplicate work traceable.
  lineage: jsonb('lineage').$type<{
    origin: string;
    sourceAppId?: string;
    sourceTemplateId?: string;
    sourceTitle?: string;
    clonedAt: string;
    clonedBy: string;
  } | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('apps_org_idx').on(t.orgId),
  index('apps_slug_idx').on(t.slug),
  index('apps_template_idx').on(t.isTemplate),
]);

// Stable catalog identity. User edits append an immutable solution_blueprint_versions row; tenant
// deployments pin that exact version so later library edits cannot rewrite deployed contracts.
export const solutionBlueprints = pgTable(
  'solution_blueprints',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().default('default'),
    currentVersion: integer('current_version').notNull().default(1),
    sourceCatalogKey: text('source_catalog_key'),
    catalogVersion: integer('catalog_version'),
    tombstonedAt: timestamp('tombstoned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('solution_blueprints_org_idx').on(t.orgId),
    uniqueIndex('solution_blueprints_catalog_key_idx').on(t.orgId, t.sourceCatalogKey),
  ],
);

export const solutionBlueprintVersions = pgTable(
  'solution_blueprint_versions',
  {
    id: text('id').primaryKey(),
    blueprintId: text('blueprint_id').notNull(),
    orgId: text('org_id').notNull().default('default'),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('solution_blueprint_versions_identity_idx').on(t.orgId, t.blueprintId, t.version),
    foreignKey({ columns: [t.blueprintId], foreignColumns: [solutionBlueprints.id] }).onDelete(
      'restrict',
    ),
  ],
);

// Records that the default blueprint library has been initialised for an organisation. Keeping
// this state separate means a user can delete or replace the defaults without them reappearing on
// the next read (or after a process restart).
export const solutionBlueprintSeedState = pgTable('solution_blueprint_seed_state', {
  orgId: text('org_id').primaryKey(),
  catalogVersion: integer('catalog_version').notNull().default(0),
  seededAt: timestamp('seeded_at', { withTimezone: true }).notNull().defaultNow(),
});

export const solutionDeployments = pgTable(
  'solution_deployments',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().default('default'),
    blueprintId: text('blueprint_id').notNull(),
    blueprintVersion: integer('blueprint_version').notNull(),
    appId: text('app_id').notNull(),
    pipelineId: text('pipeline_id').notNull(),
    status: text('status').notNull().default('active'),
    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull().defaultNow(),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('solution_deployments_org_idx').on(t.orgId),
    uniqueIndex('solution_deployments_live_app_binding_idx')
      .on(t.orgId, t.appId)
      .where(sql`${t.status} <> 'retired'`),
    foreignKey({
      columns: [t.orgId, t.blueprintId, t.blueprintVersion],
      foreignColumns: [
        solutionBlueprintVersions.orgId,
        solutionBlueprintVersions.blueprintId,
        solutionBlueprintVersions.version,
      ],
    }).onDelete('restrict'),
    foreignKey({ columns: [t.appId], foreignColumns: [apps.id] }).onDelete('restrict'),
  ],
);

export const solutionObservations = pgTable(
  'solution_observations',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().default('default'),
    deploymentId: text('deployment_id').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    claimedMetricValue: doublePrecision('claimed_metric_value').notNull(),
    claimLabel: text('claim_label').notNull(),
    runIds: jsonb('run_ids').$type<string[]>().notNull().default([]),
    runsCompleted: integer('runs_completed').notNull(),
    estimatedMinutesSavedPerRun: doublePrecision('estimated_minutes_saved_per_run').notNull(),
    estimatedLoadedCostPerHour: doublePrecision('estimated_loaded_cost_per_hour').notNull(),
    actualAiCost: doublePrecision('actual_ai_cost').notNull(),
    evidenceLinks: jsonb('evidence_links').$type<string[]>().notNull().default([]),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('solution_observations_deployment_idx').on(t.orgId, t.deploymentId),
    foreignKey({ columns: [t.deploymentId], foreignColumns: [solutionDeployments.id] }).onDelete(
      'restrict',
    ),
  ],
);

export type SolutionBlueprintRow = typeof solutionBlueprints.$inferSelect;
export type SolutionBlueprintVersionRow = typeof solutionBlueprintVersions.$inferSelect;
export type SolutionDeploymentRow = typeof solutionDeployments.$inferSelect;
export type SolutionObservationRow = typeof solutionObservations.$inferSelect;

// ─── App runs (Builder Epic #106) — a run of an app, parallel to agentRuns ─────
// Mirrors agentRuns (org-scope, status, provenance, timestamps) so the lineage/audit/trace
// fan-out reuses the same patterns. Where agentRuns is a single-shot trace, appRuns represents a
// MULTI-STEP run: `steps` holds per-step status + results, and status supports a mid-workflow
// 'awaiting_human' pause (released by a step-review route in Phase 4A).
//   status  — queued | running | awaiting_human | done | error | cancelled
//   trigger — how this run was fired (mirrors the app's TriggerSpec kind + payload snapshot).
//   input   — resolved input-form values / trigger payload for this run.
//   steps   — per-step results: {id,kind,status,outcome,refs,startedAt,finishedAt,detail}.
//   outcome — the aggregated final output/answer of the app run.
export const appRuns = pgTable('app_runs', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  appId: text('app_id').notNull(),
  status: text('status').notNull().default('queued'), // queued|running|awaiting_human|done|error|cancelled
  // How this run was fired + a snapshot of the trigger payload.
  trigger: jsonb('trigger')
    .$type<{ kind: string; payload?: Record<string, unknown> }>()
    .notNull()
    .default({ kind: 'on-demand' }),
  // Resolved input-form values / trigger input for this run.
  input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
  // Per-step results/status — the multi-step trace, incl. mid-workflow 'awaiting_human'.
  steps: jsonb('steps').$type<
    {
      id: string;
      kind: string;
      label: string;
      status: string; // pending | running | awaiting_human | done | error | skipped
      outcome?: string;
      refs?: string[];
      detail?: string;
      childRunId?: string; // agent-step child agentRuns.id, for lineage
      reviewer?: string; // authenticated reviewer identity for a human decision
      // SHADOW mode: what a side-effecting sink WOULD have done (intercepted, not delivered).
      wouldPerform?: {
        sink: string;
        recipient?: string;
        subject?: string;
        payloadPreview: string;
      };
      actionImpact?: import('@/lib/action-contract').ActionImpact;
      actionReceipt?: import('@/lib/action-contract').ActionReceipt;
      startedAt?: string;
      finishedAt?: string;
    }[]
  >().notNull().default([]),
  // Aggregated final output of the app run.
  outcome: text('outcome').notNull().default(''),
  // Detached provenance signature over the outcome — same shape as agentRuns.provenance.
  provenance: jsonb('provenance').$type<{
    signature: string;
    algorithm: string;
    publicKey: string | null;
    signedAt: string;
  }>(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [index('app_runs_app_idx').on(t.appId), index('app_runs_org_idx').on(t.orgId)]);

// Atomic post-action business facts. App Runs remain the execution owner and retain the canonical
// ActionReceipt; this table copies that signed receipt and records only what happened afterwards.
// It deliberately has no solution_deployment dependency: every governed App action can be observed.
export const actionOutcomeObservations = pgTable(
  'action_outcome_observations',
  {
    id: text('id').primaryKey(),
    observationKey: text('observation_key').notNull(),
    orgId: text('org_id').notNull(),
    appId: text('app_id').notNull(),
    runId: text('run_id').notNull(),
    stepId: text('step_id').notNull(),
    receiptIdempotencyKey: text('receipt_idempotency_key').notNull(),
    actionId: text('action_id')
      .$type<import('@/lib/action-contract').ActionId>()
      .notNull(),
    actionTarget: text('action_target').notNull(),
    actionExecutedAt: timestamp('action_executed_at', { withTimezone: true }).notNull(),
    actionReceipt: jsonb('action_receipt')
      .$type<import('@/lib/action-contract').ActionReceipt>()
      .notNull(),
    kind: text('kind')
      .$type<import('@/lib/action-outcome-contract').ActionOutcomeRecordKind>()
      .notNull(),
    outcomeCode: text('outcome_code').$type<
      import('@/lib/action-outcome-contract').ActionOutcomeCode | null
    >(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    sourceKind: text('source_kind')
      .$type<import('@/lib/action-outcome-contract').ActionOutcomeSourceKind>()
      .notNull(),
    sourceEventId: text('source_event_id').notNull(),
    sourceIdempotencyKey: text('source_idempotency_key').notNull(),
    note: text('note').notNull(),
    evidenceLinks: jsonb('evidence_links').$type<string[]>().notNull(),
    measurement: jsonb('measurement').$type<
      import('@/lib/action-outcome-contract').ActionOutcomeMeasurement | null
    >(),
    supersedesId: text('supersedes_id'),
    recordedBy: text('recorded_by').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('action_outcome_observations_key_idx').on(t.observationKey),
    uniqueIndex('action_outcome_observations_source_event_idx').on(
      t.orgId,
      t.receiptIdempotencyKey,
      t.sourceKind,
      t.sourceEventId,
    ),
    uniqueIndex('action_outcome_observations_supersedes_idx').on(t.supersedesId),
    index('action_outcome_observations_run_step_idx').on(t.orgId, t.runId, t.stepId),
    index('action_outcome_observations_app_time_idx').on(t.orgId, t.appId, t.observedAt),
    index('action_outcome_observations_receipt_time_idx').on(
      t.orgId,
      t.receiptIdempotencyKey,
      t.observedAt,
    ),
    foreignKey({ columns: [t.runId], foreignColumns: [appRuns.id] }).onDelete('restrict'),
    foreignKey({ columns: [t.appId], foreignColumns: [apps.id] }).onDelete('restrict'),
  ],
);

export type ActionOutcomeObservationRow = typeof actionOutcomeObservations.$inferSelect;
export type NewActionOutcomeObservationRow = typeof actionOutcomeObservations.$inferInsert;

// ─── Data domains (Builder Epic #107) — the connector rule-engine binding ──────
// A semantic map: a human phrase (e.g. "reimbursement quota") → a specific connector + resource
// (table / path / object). This is what turns the inert connector canvas nodes into a deterministic
// rule engine: resolveDomain(phrase) (lib/data-domains.ts, Phase 1B) matches label/aliases and
// returns the bound connector to query — a rule, never a guess.
//   aliases  — alternate phrases that resolve to this domain.
//   resource — the table/path/object within the connector to read.
//   opHints  — optional query hints (default columns, filters, limits) for the resolver.
export const dataDomains = pgTable('data_domains', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  label: text('label').notNull(),
  aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
  connectorId: text('connector_id').notNull(),
  resource: text('resource').notNull(), // table / path / object within the connector
  opHints: jsonb('op_hints').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('data_domains_org_idx').on(t.orgId), index('data_domains_connector_idx').on(t.connectorId)]);

// ─── App run controls (SHADOW MODE + BLAST-RADIUS) — the BFSI trust dials ──────
// Per-app safety controls a cautious operator sets so an autonomous app/agent can be trusted to act:
//   • enabled          — kill-switch. false ⇒ the app is DISABLED, every run denied at run start.
//   • shadowDefault    — force SHADOW mode on every run (side-effecting sinks NO-OP + record
//                        "wouldPerform") until the operator arms it live.
//   • maxRunsPerDay    — daily run cap (null ⇒ no cap).
//   • spendCapUsd      — USD spend cap (null ⇒ no cap), measured per `spendCapScope` ('day' | 'run').
// A sibling row to `apps` (one-to-one by appId), self-migrated by app-run-controls-store.ts. Absent
// row ⇒ DEFAULT_CONTROLS (enabled, live, no caps) — the app behaves EXACTLY as before (additive).
// The pure decision layer is app-run-controls.ts (evaluateBlastRadius / resolveRunMode / shadow-intercept).
export const appRunControls = pgTable('app_run_controls', {
  appId: text('app_id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  enabled: boolean('enabled').notNull().default(true),
  shadowDefault: boolean('shadow_default').notNull().default(false),
  maxRunsPerDay: integer('max_runs_per_day'),
  spendCapUsd: doublePrecision('spend_cap_usd'),
  spendCapScope: text('spend_cap_scope').notNull().default('day'), // 'day' | 'run'
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('app_run_controls_org_idx').on(t.orgId)]);

export type AppRunControlsRow = typeof appRunControls.$inferSelect;
export type NewAppRunControlsRow = typeof appRunControls.$inferInsert;

export type App = typeof apps.$inferSelect;
export type NewApp = typeof apps.$inferInsert;
export type AppRun = typeof appRuns.$inferSelect;
export type NewAppRun = typeof appRuns.$inferInsert;
export type DataDomain = typeof dataDomains.$inferSelect;
export type NewDataDomain = typeof dataDomains.$inferInsert;

// ─── Fleet nodes — SINGLE SOURCE OF TRUTH for the on-prem fleet topology ───────
// The aggregator's routing POOL, the status page's node list, and each node's
// served model all derive from this table. Editing a row here (via the AI Gateway
// console) is what changes what a node serves — the aggregator reads the derived
// pool and pushes model/restart changes to the node over SSH. See src/lib/fleet.ts
// (pure derivePool) and scripts/gateway-aggregator.mjs (consumer + executor).
export const fleetNodes = pgTable('fleet_nodes', {
  name: text('name').primaryKey(),                       // 'g1', 's1', 'g6', …
  host: text('host').notNull(),                          // 'offgrid-g1.local'
  port: integer('port').notNull().default(7878),         // llama-server / gateway port
  role: text('role').notNull().default('gateway'),       // gateway | server | image | spare
  kind: text('kind').notNull().default('chat'),          // chat | grounding | image (aggregator routing)
  model: text('model').notNull().default(''),            // routing tag, e.g. 'qwythos-9b'
  primaryGguf: text('primary_gguf').notNull().default(''),// active-model.json "primary"
  mmprojGguf: text('mmproj_gguf').notNull().default(''),  // active-model.json "mmproj" (vision)
  modelId: text('model_id').notNull().default(''),        // active-model.json "id" (HF repo id)
  contextSize: integer('context_size'),                   // n_ctx override (null = node default)
  // Distributed inference (llama.cpp RPC): a WORKER names the head it's bonded to; the head's
  // `port` is the cluster's serving port. Both null ⇒ an ordinary standalone node. See src/lib/fleet.ts.
  clusterHead: text('cluster_head'),                       // head node name this worker is bonded to
  rpcPort: integer('rpc_port'),                            // worker's ggml-rpc-server port (null = 50052)
  vision: boolean('vision').notNull().default(true),
  enabled: boolean('enabled').notNull().default(true),    // in the routing pool?
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Gateways — first-class MODEL-SERVING ENDPOINTS a pipeline runs on ─────────
// (Gateways × Pipelines architecture, P1 — docs/PIPELINES_AND_GATEWAYS_PLAN.md.)
// A gateway is the model substrate a pipeline RUNS ON. It is SHARED: many pipelines
// point at one gateway. This is the REGISTRY of them — identity (name+kind), base URL,
// default model, and the EGRESS CLASS (on-prem = data stays on the fleet; cloud = data
// leaves — the routing leash keys off this). Health/reachability is NOT stored: it is
// merged in live from the aggregator (on-prem) + the cloud-providers probe (see
// src/lib/gateways.ts), so the registry never lies about "up".
//   kind        — on-prem | openai | anthropic | compat (OpenAI-compatible proxy, e.g. OpenRouter)
//   egressClass — 'on-prem' | 'cloud' — DERIVED from kind (on-prem⇒on-prem, else cloud); stored so a
//                 query can filter without recomputing, but always kept consistent with kind on write.
export const gateways = pgTable('gateways', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  name: text('name').notNull(),
  kind: text('kind').notNull(),                                  // on-prem | openai | anthropic | compat
  baseUrl: text('base_url').notNull().default(''),
  defaultModel: text('default_model').notNull().default(''),
  egressClass: text('egress_class').notNull().default('cloud'),  // on-prem | cloud (derived from kind)
  // PA-15: the per-tenant PROVISIONED gateway HOST ("<slug5><rand5>-gateway.<apex>"), minted from
  // the tenant slug + a random suffix (tenantGatewayHost). Nullable — most gateways use the shared
  // "gateway.<apex>"; only a provisioned per-tenant gateway carries its own unguessable host. The
  // aggregator/edge resolves the tenant from the inbound Host by matching gatewayFromHost() ↔ this.
  hostname: text('hostname'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('gateways_org_idx').on(t.orgId)]);

export type Gateway = typeof gateways.$inferSelect;
export type NewGateway = typeof gateways.$inferInsert;

// ─── Pipelines (Gateways × Pipelines, the PIPELINE tier) ───────────────────────
// A Pipeline is the reusable, composable, GOVERNED model-access contract — the heart of OGAC. It
// RUNS ON a gateway (binding) and is CONSUMED BY apps/agents/chat. It owns:
//   • gatewayId + defaultModel — the binding (nullable ⇒ org default gateway).
//   • routing                  — fallback chain + egress leash (data_class → local|cloud|block).
//   • dataAllowlist            — the data-domains/classes it may touch. A HARD CEILING: a consumer
//                                can only ever touch data inside it (widen ⇒ edit the pipeline).
//   • policyOverlay / guardrailOverlay — pipeline-scoped overrides that INHERIT org defaults and may
//                                only TIGHTEN a `locked` org control, never loosen it (effectiveGovernance).
//   • version + status         — immutable version snapshots live in `pipeline_versions`; every edit
//                                bumps `version` and writes a snapshot. status: draft|published|archived.
// Evals/golden/drift + telemetry lenses attach later (a fan-out phase fills those detail tabs).
export const pipelines = pgTable('pipelines', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  visibility: text('visibility').notNull().default('private'), // 'private' | 'org' | 'public'
  // M2 lifecycle & ownership: the TEAM/BU this pipeline belongs to (null ⇒ no team; only the owner +
  // org admins have access). Team members get delegated access to their team's pipelines.
  teamId: text('team_id'),
  // The gateway binding — which gateway this pipeline runs on (null ⇒ org default gateway).
  gatewayId: text('gateway_id'),
  // Default model on that gateway (null ⇒ the gateway's own default).
  defaultModel: text('default_model'),
  // Routing: fallback chain + egress leash. Shape owned by pipelines-policy.ts; jsonb keeps it flexible.
  routing: jsonb('routing')
    .$type<{
      egressAllowed?: boolean;
      rules?: {
        name: string;
        priority: number;
        attribute: string;
        operator: string;
        value: string;
        action: string;
        model: string;
        fallback: string;
        enabled: boolean;
      }[];
    }>()
    .notNull()
    .default({}),
  // The HARD data ceiling — data-domain/class ids this pipeline may touch.
  dataAllowlist: jsonb('data_allowlist').$type<string[]>().notNull().default([]),
  // Pipeline-scoped policy overlay (inherits org defaults; may only tighten locked controls).
  policyOverlay: jsonb('policy_overlay').$type<Record<string, unknown>>().notNull().default({}),
  // Pipeline-scoped guardrail overlay (inherits org defaults; may only tighten locked controls).
  guardrailOverlay: jsonb('guardrail_overlay').$type<Record<string, unknown>>().notNull().default({}),
  // M2 lifecycle: draft → in_review → published → deprecated (+ legacy `archived`). Vocabulary owned
  // by pipeline-lifecycle-model.ts; kept as text so the enum can widen without a DB type migration.
  status: text('status').notNull().default('draft'),
  version: integer('version').notNull().default(1),
  isTemplate: boolean('is_template').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('pipelines_org_idx').on(t.orgId),
  index('pipelines_gateway_idx').on(t.gatewayId),
  index('pipelines_team_idx').on(t.teamId),
]);

// ─── Pipeline versions — immutable config snapshots ────────────────────────────
// One row per publish/edit: the FULL pipeline config at that version, frozen. Consumers will later
// PIN a version; this table is the source of truth for what a pinned version was. Append-only.
export const pipelineVersions = pgTable('pipeline_versions', {
  id: text('id').primaryKey(),
  pipelineId: text('pipeline_id').notNull(),
  orgId: text('org_id').notNull().default('default'),
  version: integer('version').notNull(),
  // The full config snapshot at this version (name, binding, routing, allowlist, overlays, …).
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull().default({}),
  note: text('note').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by').notNull().default(''),
}, (t) => [index('pipeline_versions_pipeline_idx').on(t.pipelineId)]);

export type Pipeline = typeof pipelines.$inferSelect;
export type NewPipeline = typeof pipelines.$inferInsert;
export type PipelineVersion = typeof pipelineVersions.$inferSelect;
export type NewPipelineVersion = typeof pipelineVersions.$inferInsert;

// ─── Publish-gate jobs (M1-a: ASYNC release-gate publish) ─────────────────────
// A publish that must RUN evals first is tracked as a job: the request returns 202 {status:'gating'}
// immediately, the evals run in the background, and the gate is applied on completion (publish or
// leave draft). The poll route reads this row. `decision` (jsonb) is null while gating and carries
// the ReleaseGateDecision + overridden/version once resolved. Org-scoped like everything else.
export const publishJobs = pgTable('publish_jobs', {
  id: text('id').primaryKey(),
  pipelineId: text('pipeline_id').notNull(),
  orgId: text('org_id').notNull().default('default'),
  // gating → published | blocked (see publish-job.ts for the pure transition model).
  status: text('status').notNull().default('gating'),
  // Whether an override was requested on kickoff (applied to a failing gate on resolve).
  override: boolean('override').notNull().default(false),
  createdBy: text('created_by').notNull().default(''),
  // The PublishJobDecision once resolved (decision + overridden + version); null while gating.
  decision: jsonb('decision').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('publish_jobs_pipeline_idx').on(t.pipelineId)]);

export type PublishJob = typeof publishJobs.$inferSelect;
export type NewPublishJob = typeof publishJobs.$inferInsert;

// ─── Teams / BU tier (M2 lifecycle & ownership) ───────────────────────────────
// A TEAM/BU sits between the org and the pipeline. A pipeline may belong to a team (pipelines.team_id);
// a team's members get DELEGATED access to their team's pipelines (RBAC scoped by membership). Pure
// rules in teams-policy.ts; the store + self-migrate in teams.ts. Org-scoped like everything else.
export const teams = pgTable('teams', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  // Optional DEPARTMENT this team belongs to (e.g. "Risk", "Operations", "Finance"). Nullable +
  // additive: a team with no department reads as "Unassigned" in the org-chart view. M2-a (#189).
  department: text('department'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('teams_org_idx').on(t.orgId)]);

// One row per (team, user). `userId` is the user's email/id. `role` is 'lead' (delegated edit +
// promote) or 'member' (delegated read + deprecate) — vocabulary owned by teams-policy.ts.
export const teamMembers = pgTable('team_members', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  orgId: text('org_id').notNull().default('default'),
  userId: text('user_id').notNull(),
  role: text('role').notNull().default('member'), // 'lead' | 'member'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('team_members_team_idx').on(t.teamId),
  index('team_members_user_idx').on(t.userId),
]);

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;

// Per-pipeline provisioned API keys — the pipeline is callable as its own governed endpoint by
// apps/agents/external third-parties (analogous to tenant provisioning). Only the hash is stored;
// the plaintext key is shown ONCE at mint time. `prefix` is the non-secret display stub (og_pl_…).
export const pipelineApiKeys = pgTable('pipeline_api_keys', {
  id: text('id').primaryKey(),
  pipelineId: text('pipeline_id').notNull(),
  orgId: text('org_id').notNull().default('default'),
  name: text('name').notNull().default(''),
  hashedKey: text('hashed_key').notNull(),
  prefix: text('prefix').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by').notNull().default(''),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [
  index('pipeline_api_keys_pipeline_idx').on(t.pipelineId),
  index('pipeline_api_keys_org_idx').on(t.orgId),
]);

export type PipelineApiKey = typeof pipelineApiKeys.$inferSelect;
export type NewPipelineApiKey = typeof pipelineApiKeys.$inferInsert;

// ─── Spine exporters (M6 "good citizen") ──────────────────────────────────────────────────────────
// Config for exporting the spine (audit / lineage / metrics) OUT to the enterprise's own tooling
// (Splunk, Purview/Collibra, Grafana/Prometheus). Org-scoped. `secretRef` NAMES an OpenBao key — the
// raw auth token is NEVER stored here; it's resolved at export time via the existing secret path.
// `lastStatus`/`lastAt` are the HONEST result of the most recent real test()/export() call.
export const exportTargets = pgTable('export_targets', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  kind: text('kind').notNull(), // 'audit' | 'lineage' | 'metrics'
  endpoint: text('endpoint').notNull().default(''),
  enabled: boolean('enabled').notNull().default(true),
  secretRef: text('secret_ref'), // OpenBao key path, never a value
  lastStatus: text('last_status'), // 'ok' | 'fail' | null (never tested)
  lastDetail: text('last_detail'), // human detail of the last test/export
  lastAt: timestamp('last_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('export_targets_org_idx').on(t.orgId),
]);

export type ExportTarget = typeof exportTargets.$inferSelect;
export type NewExportTarget = typeof exportTargets.$inferInsert;
// ─── M4 — Deep data governance (task #190) ────────────────────────────────────
// The data plane (Airbyte/ClickHouse on S2) will hold a warehouse full of enterprise data. These
// tables are the CONSOLE-SIDE governance registry — engine-agnostic, filled either by an operator or
// (later) by a data-pipeline sync that registers its output dataset. Pure rules live in
// data-classification.ts / data-freshness.ts / data-retention.ts / data-rtbf.ts; the store + its
// self-migrate live in data-catalog-store.ts. Org-scoped like everything else.
//
// `data_assets` — the CATALOG: "what data do I have". One row per dataset/table the org holds. Seeded
// from connectors/data-domains, and designed so a sync can register its output here (source +
// external ref + row count + last-refresh). Classification/retention hang off the asset by fk.
export const dataAssets = pgTable('data_assets', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  name: text('name').notNull(),
  // Where this asset physically lives — a free-text source label ("Warehouse", "Salesforce"), and
  // optional structured refs to the console entities it derives from (connector/data-domain).
  source: text('source').notNull().default(''),
  connectorId: text('connector_id'), // fk-ish to connectors.id (soft — connectors is org-scoped too)
  domainId: text('domain_id'), // fk-ish to data_domains.id
  kind: text('kind').notNull().default('table'), // table | view | stream | file | collection
  owner: text('owner').notNull().default(''), // steward email / team
  description: text('description').notNull().default(''),
  rowCount: integer('row_count').notNull().default(0),
  // Freshness: the SLA (max staleness allowed, in hours; 0 = no SLA) and the last observed refresh.
  freshnessSlaHours: integer('freshness_sla_hours').notNull().default(0),
  lastRefreshAt: timestamp('last_refresh_at', { withTimezone: true }),
  // Sync health as last reported by a pipeline/connector sync — drives broken-sync alerting.
  syncStatus: text('sync_status').notNull().default('unknown'), // ok | failed | unknown
  syncError: text('sync_error').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('data_assets_org_idx').on(t.orgId),
  index('data_assets_connector_idx').on(t.connectorId),
]);

// `data_classifications` — per-asset (and optionally per-column) classification + PII tags. One row
// per (asset, column); column NULL = the asset-level default classification. Drives policy: a
// `restricted` asset with PII tags is what retention/RTBF/masking key off.
export const dataClassifications = pgTable('data_classifications', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  assetId: text('asset_id').notNull(), // fk → data_assets.id
  column: text('column'), // NULL = asset-level default; else a specific column
  // public | internal | confidential | restricted (ascending sensitivity — see data-classification.ts).
  level: text('level').notNull().default('internal'),
  // PII entity tags on this asset/column — e.g. ['EMAIL','PAN','AADHAAR','PHONE']. Vocabulary is the
  // guardrails/Presidio entity set; kept as free strings so a new recognizer needs no schema change.
  piiTags: jsonb('pii_tags').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('data_classifications_org_idx').on(t.orgId),
  index('data_classifications_asset_idx').on(t.assetId),
]);

// `retention_policies` — per-asset retention rule. `retainDays` = how long data is kept before it is
// due for purge (0 = keep indefinitely). Evaluated against the asset's lastRefreshAt (data-retention.ts)
// to surface assets that are OVER retention and due for disposal.
export const retentionPolicies = pgTable('retention_policies', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  assetId: text('asset_id').notNull(), // fk → data_assets.id (one policy per asset)
  retainDays: integer('retain_days').notNull().default(0), // 0 = indefinite
  // What happens at expiry: delete (purge rows) | anonymize (strip PII) | archive (cold-store).
  action: text('action').notNull().default('delete'),
  legalHold: boolean('legal_hold').notNull().default(false), // if set, never auto-purge
  note: text('note').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('retention_policies_org_idx').on(t.orgId),
  index('retention_policies_asset_idx').on(t.assetId),
]);

// `erasure_requests` — RTBF / subject-erasure request records. The existing DSAR path
// (src/lib/erasure.ts + /api/v1/admin/erasure) EXECUTES an erasure immediately against console tables;
// this table RECORDS the request as a durable, auditable artifact and captures the resolved cross-plane
// SCOPE (which data assets across warehouse + vector store + lineage reference the subject). Actual
// warehouse purge wires when the S2 data engine is live — until then the request honestly records
// status `recorded` with the planned scope.
export const erasureRequests = pgTable('erasure_requests', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  subject: text('subject').notNull(), // the data-subject email/id to erase
  // recorded | executing | completed | partial | failed — lifecycle of the request.
  status: text('status').notNull().default('recorded'),
  // The resolved erasure SCOPE at request time: the console-owned steps that ran (from planErasure)
  // plus the cross-plane assets/stores that reference the subject and would be purged when the engine
  // is live. Auditable snapshot — what this erasure DID + WOULD touch.
  scope: jsonb('scope').$type<Record<string, unknown>>().notNull().default({}),
  erasedRows: integer('erased_rows').notNull().default(0), // rows actually deleted in the console plane
  requestedBy: text('requested_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  index('erasure_requests_org_idx').on(t.orgId),
  index('erasure_requests_subject_idx').on(t.subject),
]);

// ─── Drift monitoring system-of-record (drift-report history + trend) ─────────────────────────────
// The drift adapter produces stateless per-run verdicts; `drift_runs` retains each run with engine
// attribution. This table is the console-owned MONITORING LAYER on top of those runs: a named PROJECT
// that groups drift reports for a dataset/pipeline and carries the breach THRESHOLD used to flag
// drift over time. Report history + trend are DERIVED from the org's retained `drift_runs` (see
// evidently-projects-store.ts) — this table holds only the project config. Org-scoped like everything
// else. Pure rules live in evidently-monitoring.ts; the store + self-migrate in
// evidently-projects-store.ts. ADDITIVE — needs a db:push (orchestrator).
export const driftProjects = pgTable('drift_projects', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('default'),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  // Free-text label of the dataset/pipeline this project monitors (drift_runs carries no dataset fk,
  // so association is org-level + descriptive — see the store's honesty note).
  dataset: text('dataset').notNull().default(''),
  // Breach line in [0,1]; a bucket whose mean drift share ≥ this is flagged. Defaults to the PSI
  // "drift" threshold (0.25) so a project with no explicit line matches the engine's own verdict.
  driftThreshold: doublePrecision('drift_threshold').notNull().default(0.25),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('drift_projects_org_idx').on(t.orgId),
]);

export type DriftProjectRow = typeof driftProjects.$inferSelect;
export type NewDriftProjectRow = typeof driftProjects.$inferInsert;

export type DataAsset = typeof dataAssets.$inferSelect;
export type NewDataAsset = typeof dataAssets.$inferInsert;
export type DataClassificationRow = typeof dataClassifications.$inferSelect;
export type NewDataClassificationRow = typeof dataClassifications.$inferInsert;
export type RetentionPolicyRow = typeof retentionPolicies.$inferSelect;
export type NewRetentionPolicyRow = typeof retentionPolicies.$inferInsert;
export type ErasureRequestRow = typeof erasureRequests.$inferSelect;
export type NewErasureRequestRow = typeof erasureRequests.$inferInsert;
