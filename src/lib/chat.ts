import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { messagesUpToInclusive } from '@/lib/chat-policy';
import { getObjectText, putObject } from '@/lib/files';
import {
  chatArtifacts,
  chatArtifactVersions,
  chatConversations,
  chatMemory,
  chatMessages,
  chatPrefs,
  chatProjectMembers,
  chatProjectMemory,
  chatProjects,
  chatSettings,
  chatSkills,
} from '@/db/schema';

// Chat workspace server logic — ports Off Grid AI Desktop's project/thread/message store to the
// console, backed by the on-prem gateway for inference. Tables are created idempotently on first
// use so the module deploys over SSH with no migration step.

let ensurePromise: Promise<void> | null = null;
export async function ensureChatSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_projects (
      id text PRIMARY KEY, user_id text NOT NULL, name text NOT NULL,
      description text NOT NULL DEFAULT '', system_prompt text NOT NULL DEFAULT '', icon text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id text PRIMARY KEY, user_id text NOT NULL, project_id text,
      title text NOT NULL DEFAULT 'New chat', model text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id text PRIMARY KEY, conversation_id text NOT NULL, role text NOT NULL,
      content text NOT NULL DEFAULT '', reasoning text, images jsonb, citations jsonb,
      created_at timestamptz NOT NULL DEFAULT now());
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS chat_messages_conv_idx ON chat_messages (conversation_id, created_at);`,
  );
  // Edit & branch (Wave 2): parent-pointer tree columns (added post-hoc for existing tables).
  await db.execute(sql`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS parent_id text;`);
  await db.execute(
    sql`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;`,
  );
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_settings (
      user_id text PRIMARY KEY, custom_instructions text NOT NULL DEFAULT '',
      updated_at timestamptz NOT NULL DEFAULT now());
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_skills (
      id text PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '',
      system_prompt text NOT NULL DEFAULT '', model text NOT NULL DEFAULT '', project_id text,
      allowed_roles jsonb NOT NULL DEFAULT '[]', icon text, enabled boolean NOT NULL DEFAULT true,
      created_by text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
  `);
  // Assistant-builder fields on skills (added post-hoc for existing tables).
  await db.execute(
    sql`ALTER TABLE chat_skills ADD COLUMN IF NOT EXISTS conversation_starters jsonb NOT NULL DEFAULT '[]';`,
  );
  await db.execute(
    sql`ALTER TABLE chat_skills ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}';`,
  );
  await db.execute(
    sql`ALTER TABLE chat_skills ADD COLUMN IF NOT EXISTS actions_schema text NOT NULL DEFAULT '';`,
  );
  await db.execute(
    sql`ALTER TABLE chat_skills ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'org';`,
  );
  // Project sharing + per-project memory (added post-hoc for existing tables).
  await db.execute(
    sql`ALTER TABLE chat_projects ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';`,
  );
  // Per-project pipeline binding (CONSUMERS-BIND #166) — null ⇒ inherit the org-default chat pipeline.
  await db.execute(sql`ALTER TABLE chat_projects ADD COLUMN IF NOT EXISTS pipeline_id text;`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_project_members (
      project_id text NOT NULL, user_id text NOT NULL,
      can_edit boolean NOT NULL DEFAULT false, added_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (project_id, user_id));
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_project_memory (
      id text PRIMARY KEY, project_id text NOT NULL, fact text NOT NULL,
      source text NOT NULL DEFAULT 'chat', created_at timestamptz NOT NULL DEFAULT now());
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS chat_project_memory_idx ON chat_project_memory (project_id);`,
  );
  // conversations can be bound to a skill (added post-hoc for existing tables)
  await db.execute(sql`ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS skill_id text;`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_memory (
      id text PRIMARY KEY, user_id text NOT NULL, fact text NOT NULL,
      source text NOT NULL DEFAULT 'chat', created_at timestamptz NOT NULL DEFAULT now());
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_memory_user_idx ON chat_memory (user_id);`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_artifacts (
      id text PRIMARY KEY, user_id text NOT NULL, kind text NOT NULL,
      code text NOT NULL DEFAULT '', language text, title text NOT NULL DEFAULT 'Untitled artifact',
      conversation_id text, created_at timestamptz NOT NULL DEFAULT now());
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS chat_artifacts_user_idx ON chat_artifacts (user_id, created_at);`,
  );
  // Wave 1 additive columns: versioning head pointer + publish/share + org scope.
  await db.execute(sql`ALTER TABLE chat_artifacts ADD COLUMN IF NOT EXISTS org_id text;`);
  await db.execute(
    sql`ALTER TABLE chat_artifacts ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false;`,
  );
  await db.execute(sql`ALTER TABLE chat_artifacts ADD COLUMN IF NOT EXISTS published_at timestamptz;`);
  await db.execute(
    sql`ALTER TABLE chat_artifacts ADD COLUMN IF NOT EXISTS current_version integer NOT NULL DEFAULT 1;`,
  );
  await db.execute(
    sql`ALTER TABLE chat_artifacts ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();`,
  );
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_artifact_versions (
      id text PRIMARY KEY, artifact_id text NOT NULL, version integer NOT NULL,
      kind text NOT NULL, code text NOT NULL DEFAULT '', language text,
      created_at timestamptz NOT NULL DEFAULT now());
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS chat_artifact_versions_idx ON chat_artifact_versions (artifact_id, version);`,
  );
  // Artifact bodies live in SeaweedFS; self-migrate the key/hash columns and relax the legacy
  // NOT NULL on `code` (new writes leave it empty). ADD COLUMN IF NOT EXISTS = no migration step.
  for (const t of ['chat_artifacts', 'chat_artifact_versions']) {
    await db.execute(sql.raw(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS code_key text;`));
    await db.execute(sql.raw(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS code_hash text;`));
    await db.execute(sql.raw(`ALTER TABLE ${t} ALTER COLUMN code DROP NOT NULL;`));
  }
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_prefs (
      user_id text PRIMARY KEY, prefs jsonb NOT NULL DEFAULT '{}',
      updated_at timestamptz NOT NULL DEFAULT now());
  `);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

// ─── Per-user cross-conversation memory ───────────────────────────────────────
export async function listMemory(userId: string) {
  await ensureChatSchema();
  return db
    .select()
    .from(chatMemory)
    .where(eq(chatMemory.userId, userId))
    .orderBy(desc(chatMemory.createdAt));
}

export async function addMemory(userId: string, fact: string, source = 'chat') {
  await ensureChatSchema();
  const f = fact.trim().slice(0, 500);
  if (!f) return;
  // Skip near-duplicates (exact match) so memory doesn't bloat.
  const existing = await db
    .select({ id: chatMemory.id })
    .from(chatMemory)
    .where(and(eq(chatMemory.userId, userId), eq(chatMemory.fact, f)));
  if (existing.length) return;
  await db.insert(chatMemory).values({ id: rid(), userId, fact: f, source });
}

export async function deleteMemory(userId: string, id: string) {
  await ensureChatSchema();
  await db.delete(chatMemory).where(and(eq(chatMemory.id, id), eq(chatMemory.userId, userId)));
}

// Resolve a set of memory fact ids → their text, SCOPED to the owning user (an @-mention can only
// reference the caller's own memories — the WHERE userId guard prevents referencing someone else's
// facts by id). Returns the fact strings in no particular order; unknown/other-user ids are dropped.
export async function memoryFactsByIds(userId: string, ids: string[]): Promise<string[]> {
  const clean = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.length > 0)));
  if (!clean.length) return [];
  await ensureChatSchema();
  const rows = await db
    .select({ fact: chatMemory.fact })
    .from(chatMemory)
    .where(and(eq(chatMemory.userId, userId), inArray(chatMemory.id, clean)));
  return rows.map((r) => r.fact);
}

// Format the user's memories as a system block injected into every chat.
export async function memoryBlock(userId: string): Promise<string> {
  const rows = await listMemory(userId);
  if (!rows.length) return '';
  return (
    '<user_memory>\nRelevant facts remembered about this user from past conversations:\n' +
    rows.map((r) => `- ${r.fact}`).join('\n') +
    '\n</user_memory>'
  );
}

// ─── Org skills (RBAC-scoped reusable assistants) ─────────────────────────────
// Visible to a user if the skill is enabled AND (no allowedRoles restriction OR the user's role
// is listed). Admins see all.
export async function listSkills(
  role: string,
  userId?: string,
): Promise<(typeof chatSkills.$inferSelect)[]> {
  await ensureChatSchema();
  const all = await db.select().from(chatSkills).orderBy(desc(chatSkills.createdAt));
  if (role === 'admin') return all;
  return all.filter((s) => {
    // Private assistants are visible only to their creator.
    if (s.visibility === 'private' && s.createdBy !== userId) return false;
    return s.enabled && (!s.allowedRoles?.length || s.allowedRoles.includes(role));
  });
}

export async function getSkill(id: string) {
  await ensureChatSchema();
  const [s] = await db.select().from(chatSkills).where(eq(chatSkills.id, id));
  return s ?? null;
}

// eslint-disable-next-line complexity
export async function createSkill(createdBy: string, s: Partial<typeof chatSkills.$inferInsert>) {
  await ensureChatSchema();
  const id = rid();
  await db.insert(chatSkills).values({
    id,
    name: (s.name ?? 'New skill').slice(0, 120),
    description: s.description ?? '',
    systemPrompt: s.systemPrompt ?? '',
    model: s.model ?? '',
    projectId: s.projectId ?? null,
    allowedRoles: s.allowedRoles ?? [],
    icon: s.icon ?? null,
    conversationStarters: s.conversationStarters ?? [],
    capabilities: s.capabilities ?? {},
    actionsSchema: s.actionsSchema ?? '',
    visibility: s.visibility ?? 'org',
    createdBy,
  });
  return id;
}

export async function updateSkill(id: string, patch: Partial<typeof chatSkills.$inferInsert>) {
  await ensureChatSchema();
  await db.update(chatSkills).set(patch).where(eq(chatSkills.id, id));
}

export async function deleteSkill(id: string) {
  await ensureChatSchema();
  await db.delete(chatSkills).where(eq(chatSkills.id, id));
}

export async function getCustomInstructions(userId: string): Promise<string> {
  await ensureChatSchema();
  const [s] = await db.select().from(chatSettings).where(eq(chatSettings.userId, userId));
  return s?.customInstructions ?? '';
}

export async function setCustomInstructions(userId: string, text: string): Promise<void> {
  await ensureChatSchema();
  await db
    .insert(chatSettings)
    .values({ userId, customInstructions: text })
    .onConflictDoUpdate({
      target: chatSettings.userId,
      set: { customInstructions: text, updatedAt: new Date() },
    });
}

// Drop the last assistant message of a conversation (used by "regenerate").
export async function dropLastAssistant(conversationId: string): Promise<void> {
  await ensureChatSchema();
  const rows = await db
    .select({ id: chatMessages.id, role: chatMessages.role })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);
  if (rows[0]?.role === 'assistant') {
    await db.delete(chatMessages).where(eq(chatMessages.id, rows[0].id));
  }
}

// Prepare a regenerate: the shown path ends in an assistant turn; branch a new answer under the
// same user parent (keeping the old answer as a sibling). Returns that parent user-message id, or
// null if there's no assistant to regenerate. addMessage(parentId) then attaches the new answer.
export async function prepareRegenerate(conversationId: string): Promise<string | null> {
  await ensureChatSchema();
  const path = await listMessages(conversationId);
  const last = path[path.length - 1];
  if (!last || last.role !== 'assistant') return null;
  await deactivateSiblings(conversationId, last.parentId ?? '');
  return last.parentId ?? null;
}

const rid = () => crypto.randomUUID();

export async function listConversations(userId: string) {
  await ensureChatSchema();
  return db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.userId, userId))
    .orderBy(desc(chatConversations.updatedAt));
}

export async function createConversation(
  userId: string,
  projectId?: string | null,
  skillId?: string | null,
) {
  await ensureChatSchema();
  const id = rid();
  await db
    .insert(chatConversations)
    .values({ id, userId, projectId: projectId ?? null, skillId: skillId ?? null });
  return id;
}

export async function getConversation(userId: string, id: string) {
  await ensureChatSchema();
  const [c] = await db
    .select()
    .from(chatConversations)
    .where(and(eq(chatConversations.id, id), eq(chatConversations.userId, userId)));
  return c ?? null;
}

// All rows for a conversation (every branch), oldest first. Used to compute the active path and
// per-turn branch counts.
async function allMessages(conversationId: string) {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(asc(chatMessages.createdAt));
}

// The shown transcript: walk the parent-pointer tree from the root, picking the active child at
// each step. Each returned message carries branch metadata (index/count among its siblings) so the
// UI can render ‹ 2/3 › navigation on turns that were edited/regenerated.
export type ThreadMessage = typeof chatMessages.$inferSelect & {
  branchIndex: number;
  branchCount: number;
};
// eslint-disable-next-line complexity
export async function listMessages(conversationId: string): Promise<ThreadMessage[]> {
  await ensureChatSchema();
  const rows = await allMessages(conversationId);
  if (!rows.length) return [];
  // Group children by parent (null parent = roots). Preserve creation order within a group.
  const byParent = new Map<string, (typeof rows)[number][]>();
  for (const r of rows) {
    const key = r.parentId ?? '';
    const arr = byParent.get(key) ?? [];
    arr.push(r);
    byParent.set(key, arr);
  }
  const out: ThreadMessage[] = [];
  let parentKey = '';
  for (;;) {
    const siblings = byParent.get(parentKey);
    if (!siblings || !siblings.length) break;
    const idx = Math.max(0, siblings.findIndex((s) => s.active));
    const chosen = siblings[idx] ?? siblings[siblings.length - 1];
    out.push({ ...chosen, branchIndex: idx, branchCount: siblings.length });
    parentKey = chosen.id;
  }
  return out;
}

// The id of the current active leaf (deepest message on the shown path) — the parent for the next
// appended message. Null for an empty conversation.
export async function activeLeafId(conversationId: string): Promise<string | null> {
  const path = await listMessages(conversationId);
  return path.length ? path[path.length - 1].id : null;
}

export async function addMessage(m: {
  conversationId: string;
  role: string;
  content: string;
  reasoning?: string | null;
  images?: string[] | null;
  citations?: { name: string; position: number; score: number }[] | null;
  parentId?: string | null;
}) {
  await ensureChatSchema();
  const id = rid();
  // Default the parent to the current active leaf so appended turns extend the shown branch.
  const parentId =
    m.parentId !== undefined ? m.parentId : await activeLeafId(m.conversationId);
  await db.insert(chatMessages).values({
    id,
    conversationId: m.conversationId,
    role: m.role,
    content: m.content,
    reasoning: m.reasoning ?? null,
    images: m.images ?? null,
    citations: m.citations ?? null,
    parentId: parentId ?? null,
    active: true,
  });
  await db
    .update(chatConversations)
    .set({ updatedAt: new Date() })
    .where(eq(chatConversations.id, m.conversationId));
  return id;
}

// Edit a prior user message → create a new sibling branch under the same parent and make it the
// active path. The old branch is preserved (its messages stay in the DB, just deactivated at the
// fork). Returns the new user message id so the stream route can re-answer from it.
export async function branchUserMessage(
  conversationId: string,
  messageId: string,
  newContent: string,
): Promise<string | null> {
  await ensureChatSchema();
  const [orig] = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.conversationId, conversationId)));
  if (!orig || orig.role !== 'user') return null;
  // Deactivate every sibling under the same parent so the new branch becomes the shown path.
  const parentKey = orig.parentId ?? '';
  await deactivateSiblings(conversationId, parentKey);
  const id = rid();
  await db.insert(chatMessages).values({
    id,
    conversationId,
    role: 'user',
    content: newContent,
    images: orig.images ?? null,
    parentId: orig.parentId ?? null,
    active: true,
  });
  await db
    .update(chatConversations)
    .set({ updatedAt: new Date() })
    .where(eq(chatConversations.id, conversationId));
  return id;
}

// ─── Edit a prior user message → truncate & re-run (Phase 4.6) ────────────────
// The pure truncation rule lives in chat-policy.ts (zero imports, unit-tested); re-export it so
// callers keep a single import surface.
export { messagesUpToInclusive };

// Edit a prior user message in place and truncate the thread after it, so the conversation re-runs
// cleanly from the edit point. Verifies ownership (via the conversation), that the target is a
// `user` message, updates its content, and DELETES every later message on the active path. Returns
// the surviving (truncated) message list, or null if the caller doesn't own the conversation or the
// target isn't an editable user message.
export async function editUserMessage(
  userId: string,
  conversationId: string,
  messageId: string,
  newContent: string,
): Promise<ThreadMessage[] | null> {
  await ensureChatSchema();
  // Ownership: the conversation must belong to the caller.
  const convo = await getConversation(userId, conversationId);
  if (!convo) return null;
  // Operate on the shown (active) path so "everything after" matches what the user sees.
  const path = await listMessages(conversationId);
  const survivors = messagesUpToInclusive(path, messageId);
  if (!survivors.length) return null;
  const target = survivors[survivors.length - 1];
  if (target.role !== 'user') return null;
  // Update the target's content in place.
  await db
    .update(chatMessages)
    .set({ content: String(newContent) })
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.conversationId, conversationId)));
  // Drop every message after the target on the active path (the tail we're re-running from).
  const survivorIds = new Set(survivors.map((m) => m.id));
  for (const m of path) {
    if (!survivorIds.has(m.id)) {
      await db.delete(chatMessages).where(eq(chatMessages.id, m.id));
    }
  }
  await db
    .update(chatConversations)
    .set({ updatedAt: new Date() })
    .where(eq(chatConversations.id, conversationId));
  return listMessages(conversationId);
}

// Switch which sibling of a given message is active (branch navigation ‹ 2/3 ›). `messageId` is
// any current-path message; `delta` moves +1/-1 among its siblings.
export async function switchBranch(
  conversationId: string,
  messageId: string,
  delta: number,
): Promise<boolean> {
  await ensureChatSchema();
  const rows = await allMessages(conversationId);
  const target = rows.find((r) => r.id === messageId);
  if (!target) return false;
  const parentKey = target.parentId ?? '';
  const siblings = rows.filter((r) => (r.parentId ?? '') === parentKey);
  if (siblings.length < 2) return false;
  const cur = siblings.findIndex((s) => s.id === messageId);
  const next = (cur + delta + siblings.length) % siblings.length;
  await deactivateSiblings(conversationId, parentKey);
  await db.update(chatMessages).set({ active: true }).where(eq(chatMessages.id, siblings[next].id));
  return true;
}

async function deactivateSiblings(conversationId: string, parentKey: string) {
  const cond = parentKey
    ? and(eq(chatMessages.conversationId, conversationId), eq(chatMessages.parentId, parentKey))
    : and(
        eq(chatMessages.conversationId, conversationId),
        sql`${chatMessages.parentId} IS NULL`,
      );
  await db.update(chatMessages).set({ active: false }).where(cond);
}

export async function renameConversation(userId: string, id: string, title: string) {
  await ensureChatSchema();
  await db
    .update(chatConversations)
    .set({ title: title.slice(0, 120) })
    .where(and(eq(chatConversations.id, id), eq(chatConversations.userId, userId)));
}

export async function deleteConversation(userId: string, id: string) {
  await ensureChatSchema();
  await db
    .delete(chatConversations)
    .where(and(eq(chatConversations.id, id), eq(chatConversations.userId, userId)));
  await db.delete(chatMessages).where(eq(chatMessages.conversationId, id));
}

// ─── Projects (containers with a system prompt; group conversations) ──────────
export async function listProjects(userId: string) {
  await ensureChatSchema();
  const rows = await db
    .select()
    .from(chatProjects)
    .where(eq(chatProjects.userId, userId))
    .orderBy(desc(chatProjects.updatedAt));
  // Enrich each project with its conversation count so the Workspace grid can show "N chats"
  // without an N+1 fetch. One grouped count query over the user's conversations.
  const counts = await db
    .select({
      projectId: chatConversations.projectId,
      n: sql<number>`count(*)::int`,
    })
    .from(chatConversations)
    .where(eq(chatConversations.userId, userId))
    .groupBy(chatConversations.projectId);
  const byProject = new Map(counts.map((c) => [c.projectId, Number(c.n)]));
  return rows.map((p) => ({ ...p, chatCount: byProject.get(p.id) ?? 0 }));
}

export async function createProject(
  userId: string,
  name: string,
  systemPrompt = '',
  pipelineId: string | null = null,
) {
  await ensureChatSchema();
  const id = rid();
  await db
    .insert(chatProjects)
    .values({ id, userId, name: name.slice(0, 120), systemPrompt, pipelineId });
  return id;
}

export async function updateProject(
  userId: string,
  id: string,
  patch: { name?: string; description?: string; systemPrompt?: string; pipelineId?: string | null },
) {
  await ensureChatSchema();
  await db
    .update(chatProjects)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(chatProjects.id, id), eq(chatProjects.userId, userId)));
}

// Update a project's fields without the owner filter — the caller must have already been checked
// for edit access (owner, member-editor, or admin). Used by the access-aware PATCH route.
// NOTE: pipelineId must be GATED against the org allowlist by the caller (isChatPipelineAllowed).
export async function updateProjectFields(
  id: string,
  patch: { name?: string; description?: string; systemPrompt?: string; pipelineId?: string | null },
) {
  await ensureChatSchema();
  await db
    .update(chatProjects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(chatProjects.id, id));
}

// A project's pipeline binding (null = inherit the org default). Powers resolveChatPipeline + the
// Overview "Consumers" section (listProjectsByPipeline).
export async function getProjectBinding(
  projectId: string | null,
): Promise<{ pipelineId: string | null } | null> {
  if (!projectId) return null;
  await ensureChatSchema();
  const [p] = await db.select().from(chatProjects).where(eq(chatProjects.id, projectId));
  return p ? { pipelineId: p.pipelineId ?? null } : null;
}

// List the projects BOUND to a given pipeline (Overview "Consumers"). Read-only, stable order.
export async function listProjectsByPipeline(
  pipelineId: string,
): Promise<{ id: string; name: string; userId: string }[]> {
  await ensureChatSchema();
  const rows = await db
    .select({ id: chatProjects.id, name: chatProjects.name, userId: chatProjects.userId })
    .from(chatProjects)
    .where(eq(chatProjects.pipelineId, pipelineId))
    .orderBy(desc(chatProjects.updatedAt));
  return rows;
}

export async function deleteProject(userId: string, id: string) {
  await ensureChatSchema();
  await db.delete(chatProjects).where(and(eq(chatProjects.id, id), eq(chatProjects.userId, userId)));
  // Detach its conversations (keep the chats, just un-project them).
  await db
    .update(chatConversations)
    .set({ projectId: null })
    .where(and(eq(chatConversations.projectId, id), eq(chatConversations.userId, userId)));
}

// A conversation's project system prompt (empty for ad-hoc chats).
export async function projectSystemPrompt(projectId: string | null): Promise<string> {
  if (!projectId) return '';
  const [p] = await db.select().from(chatProjects).where(eq(chatProjects.id, projectId));
  return p?.systemPrompt?.trim() ?? '';
}

// ─── Project sharing (visibility + members with view/edit) ────────────────────
// A user's access to a project. Owners have full access; members get view or edit; admins may
// manage any. Used to gate the detail page and mutations RBAC-aware.
export type ProjectAccess = 'owner' | 'edit' | 'view' | null;
export async function projectAccess(
  userId: string,
  projectId: string,
  role = 'viewer',
): Promise<ProjectAccess> {
  await ensureChatSchema();
  const [p] = await db.select().from(chatProjects).where(eq(chatProjects.id, projectId));
  if (!p) return null;
  if (p.userId === userId) return 'owner';
  if (role === 'admin') return 'edit';
  const [m] = await db
    .select()
    .from(chatProjectMembers)
    .where(and(eq(chatProjectMembers.projectId, projectId), eq(chatProjectMembers.userId, userId)));
  if (m) return m.canEdit ? 'edit' : 'view';
  return null;
}

// Projects shared WITH a user (they're a member of, not the owner).
export async function listSharedProjects(userId: string) {
  await ensureChatSchema();
  const memberships = await db
    .select()
    .from(chatProjectMembers)
    .where(eq(chatProjectMembers.userId, userId));
  const out: (typeof chatProjects.$inferSelect & { canEdit: boolean })[] = [];
  for (const m of memberships) {
    const [p] = await db.select().from(chatProjects).where(eq(chatProjects.id, m.projectId));
    if (p) out.push({ ...p, canEdit: m.canEdit });
  }
  return out.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
}

export async function listProjectMembers(projectId: string) {
  await ensureChatSchema();
  return db
    .select()
    .from(chatProjectMembers)
    .where(eq(chatProjectMembers.projectId, projectId))
    .orderBy(desc(chatProjectMembers.addedAt));
}

export async function addProjectMember(projectId: string, userId: string, canEdit = false) {
  await ensureChatSchema();
  const u = userId.trim().toLowerCase();
  if (!u) return;
  await db
    .insert(chatProjectMembers)
    .values({ projectId, userId: u, canEdit })
    .onConflictDoUpdate({
      target: [chatProjectMembers.projectId, chatProjectMembers.userId],
      set: { canEdit },
    });
}

export async function removeProjectMember(projectId: string, userId: string) {
  await ensureChatSchema();
  await db
    .delete(chatProjectMembers)
    .where(and(eq(chatProjectMembers.projectId, projectId), eq(chatProjectMembers.userId, userId)));
}

export async function setProjectVisibility(projectId: string, visibility: string) {
  await ensureChatSchema();
  await db
    .update(chatProjects)
    .set({ visibility: visibility === 'org' ? 'org' : 'private', updatedAt: new Date() })
    .where(eq(chatProjects.id, projectId));
}

// ─── Per-project memory (project-scoped facts injected into that project's chats) ──
export async function listProjectMemory(projectId: string) {
  await ensureChatSchema();
  return db
    .select()
    .from(chatProjectMemory)
    .where(eq(chatProjectMemory.projectId, projectId))
    .orderBy(desc(chatProjectMemory.createdAt));
}

export async function addProjectMemory(projectId: string, fact: string, source = 'chat') {
  await ensureChatSchema();
  const f = fact.trim().slice(0, 500);
  if (!f) return;
  const existing = await db
    .select({ id: chatProjectMemory.id })
    .from(chatProjectMemory)
    .where(and(eq(chatProjectMemory.projectId, projectId), eq(chatProjectMemory.fact, f)));
  if (existing.length) return;
  await db.insert(chatProjectMemory).values({ id: rid(), projectId, fact: f, source });
}

export async function deleteProjectMemory(projectId: string, id: string) {
  await ensureChatSchema();
  await db
    .delete(chatProjectMemory)
    .where(and(eq(chatProjectMemory.id, id), eq(chatProjectMemory.projectId, projectId)));
}

// Format a project's memories as a system block injected into that project's chats.
export async function projectMemoryBlock(projectId: string | null): Promise<string> {
  if (!projectId) return '';
  const rows = await listProjectMemory(projectId);
  if (!rows.length) return '';
  return (
    '<project_memory>\nFacts remembered for this project from past conversations:\n' +
    rows.map((r) => `- ${r.fact}`).join('\n') +
    '\n</project_memory>'
  );
}

// ─── Artifacts library (saved renderable outputs, promoted to a top-level surface) ──
// Bodies live in SeaweedFS (the single file-storage layer) at codeKey; Postgres holds metadata
// + a sha256 (codeHash) for dedupe. Reads hydrate `code` from SeaweedFS so every caller/route/
// component keeps the same shape (SeaweedFS is on the same host, so reads are ~loopback-fast).
const ARTIFACT_EXT: Record<string, string> = { svg: 'svg', html: 'html', mermaid: 'mmd', react: 'jsx', code: 'txt', text: 'txt' };
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
async function putArtifactBody(artifactId: string, version: number, kind: string, code: string): Promise<{ key: string; hash: string }> {
  const key = `artifacts/${artifactId}/v${version}.${ARTIFACT_EXT[kind] ?? 'txt'}`;
  await putObject(key, code, 'text/plain; charset=utf-8');
  return { key, hash: hashCode(code) };
}
// Hydrate the body: prefer SeaweedFS (codeKey), fall back to the legacy `code` column for rows
// written before the migration.
async function bodyOf(row: { codeKey?: string | null; code?: string | null }): Promise<string> {
  if (row.codeKey) return (await getObjectText(row.codeKey)) ?? '';
  return row.code ?? '';
}

export async function listArtifacts(userId: string) {
  await ensureChatSchema();
  const rows = await db
    .select()
    .from(chatArtifacts)
    .where(eq(chatArtifacts.userId, userId))
    .orderBy(desc(chatArtifacts.updatedAt));
  return Promise.all(rows.map(async (r) => ({ ...r, code: await bodyOf(r) })));
}

// Save-on-open. Versioned by (user, conversation, title): re-saving the same logical artifact
// appends a new version and advances the head; identical code to the current head is a no-op so
// simply opening the same artifact twice doesn't inflate history.
// eslint-disable-next-line complexity
export async function saveArtifact(
  userId: string,
  a: {
    kind: string;
    code: string;
    language?: string | null;
    title?: string;
    conversationId?: string | null;
    orgId?: string | null;
  },
) {
  await ensureChatSchema();
  const code = String(a.code ?? '');
  const title = (a.title ?? 'Untitled artifact').slice(0, 200);
  const [existing] = await db
    .select()
    .from(chatArtifacts)
    .where(
      and(
        eq(chatArtifacts.userId, userId),
        eq(chatArtifacts.title, title),
        a.conversationId
          ? eq(chatArtifacts.conversationId, a.conversationId)
          : sql`${chatArtifacts.conversationId} IS NULL`,
      ),
    )
    .limit(1);

  const hash = hashCode(code);

  if (existing) {
    // Identical head → no-op (opening an unchanged artifact again). Compare by hash so we don't
    // fetch the body; fall back to hashing the legacy column for pre-migration rows.
    const existingHash = existing.codeHash ?? hashCode(existing.code ?? '');
    if (existingHash === hash && existing.kind === a.kind) return existing.id;
    const next = (existing.currentVersion ?? 1) + 1;
    const { key } = await putArtifactBody(existing.id, next, a.kind, code);
    await db.insert(chatArtifactVersions).values({
      id: rid(),
      artifactId: existing.id,
      version: next,
      kind: a.kind,
      code: '',
      codeKey: key,
      codeHash: hash,
      language: a.language ?? null,
    });
    await db
      .update(chatArtifacts)
      .set({
        kind: a.kind,
        code: '',
        codeKey: key,
        codeHash: hash,
        language: a.language ?? null,
        currentVersion: next,
        updatedAt: new Date(),
      })
      .where(eq(chatArtifacts.id, existing.id));
    return existing.id;
  }

  const id = rid();
  const { key } = await putArtifactBody(id, 1, a.kind, code);
  await db.insert(chatArtifacts).values({
    id,
    userId,
    kind: a.kind,
    code: '',
    codeKey: key,
    codeHash: hash,
    language: a.language ?? null,
    title,
    conversationId: a.conversationId ?? null,
    orgId: a.orgId ?? null,
    currentVersion: 1,
  });
  await db.insert(chatArtifactVersions).values({
    id: rid(),
    artifactId: id,
    version: 1,
    kind: a.kind,
    code: '',
    codeKey: key,
    codeHash: hash,
    language: a.language ?? null,
  });
  return id;
}

export async function deleteArtifact(userId: string, id: string) {
  await ensureChatSchema();
  const [owned] = await db
    .select({ id: chatArtifacts.id })
    .from(chatArtifacts)
    .where(and(eq(chatArtifacts.id, id), eq(chatArtifacts.userId, userId)))
    .limit(1);
  if (!owned) return;
  await db.delete(chatArtifactVersions).where(eq(chatArtifactVersions.artifactId, id));
  await db.delete(chatArtifacts).where(eq(chatArtifacts.id, id));
}

// Full version history for an owned artifact (newest first).
export async function listArtifactVersions(userId: string, id: string) {
  await ensureChatSchema();
  const [owned] = await db
    .select({ id: chatArtifacts.id })
    .from(chatArtifacts)
    .where(and(eq(chatArtifacts.id, id), eq(chatArtifacts.userId, userId)))
    .limit(1);
  if (!owned) return null;
  const rows = await db
    .select()
    .from(chatArtifactVersions)
    .where(eq(chatArtifactVersions.artifactId, id))
    .orderBy(desc(chatArtifactVersions.version));
  return Promise.all(rows.map(async (r) => ({ ...r, code: await bodyOf(r) })));
}

// Revert: copy an existing version's content forward as a new head version.
export async function revertArtifact(userId: string, id: string, version: number) {
  await ensureChatSchema();
  const [art] = await db
    .select()
    .from(chatArtifacts)
    .where(and(eq(chatArtifacts.id, id), eq(chatArtifacts.userId, userId)))
    .limit(1);
  if (!art) return null;
  const [target] = await db
    .select()
    .from(chatArtifactVersions)
    .where(and(eq(chatArtifactVersions.artifactId, id), eq(chatArtifactVersions.version, version)))
    .limit(1);
  if (!target) return null;
  const next = (art.currentVersion ?? 1) + 1;
  // Copy the target version's body forward as a new head version (re-put to its own key).
  const targetCode = await bodyOf(target);
  const { key, hash } = await putArtifactBody(id, next, target.kind, targetCode);
  await db.insert(chatArtifactVersions).values({
    id: rid(),
    artifactId: id,
    version: next,
    kind: target.kind,
    code: '',
    codeKey: key,
    codeHash: hash,
    language: target.language,
  });
  await db
    .update(chatArtifacts)
    .set({
      kind: target.kind,
      code: '',
      codeKey: key,
      codeHash: hash,
      language: target.language,
      currentVersion: next,
      updatedAt: new Date(),
    })
    .where(eq(chatArtifacts.id, id));
  return next;
}

// Toggle publish state. Published artifacts render at the read-only /artifacts/[id]/view route.
export async function setArtifactPublished(userId: string, id: string, published: boolean) {
  await ensureChatSchema();
  const [owned] = await db
    .select({ id: chatArtifacts.id })
    .from(chatArtifacts)
    .where(and(eq(chatArtifacts.id, id), eq(chatArtifacts.userId, userId)))
    .limit(1);
  if (!owned) return false;
  await db
    .update(chatArtifacts)
    .set({ published, publishedAt: published ? new Date() : null, updatedAt: new Date() })
    .where(eq(chatArtifacts.id, id));
  return true;
}

// Public read for the share/embed route: only returns published artifacts (no auth).
export async function getPublishedArtifact(id: string) {
  await ensureChatSchema();
  const [a] = await db
    .select()
    .from(chatArtifacts)
    .where(and(eq(chatArtifacts.id, id), eq(chatArtifacts.published, true)))
    .limit(1);
  if (!a) return null;
  return { ...a, code: await bodyOf(a) };
}

// ─── Per-user preferences (Settings modal capabilities/appearance) ────────────
export async function getPrefs(userId: string): Promise<Record<string, unknown>> {
  await ensureChatSchema();
  const [p] = await db.select().from(chatPrefs).where(eq(chatPrefs.userId, userId));
  return p?.prefs ?? {};
}

export async function setPrefs(userId: string, prefs: Record<string, unknown>): Promise<void> {
  await ensureChatSchema();
  await db
    .insert(chatPrefs)
    .values({ userId, prefs })
    .onConflictDoUpdate({ target: chatPrefs.userId, set: { prefs, updatedAt: new Date() } });
}

// ─── Data & privacy: bulk export / delete of the user's chats ─────────────────
export async function deleteAllConversations(userId: string): Promise<void> {
  await ensureChatSchema();
  const rows = await db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(eq(chatConversations.userId, userId));
  for (const r of rows) {
    await db.delete(chatMessages).where(eq(chatMessages.conversationId, r.id));
  }
  await db.delete(chatConversations).where(eq(chatConversations.userId, userId));
}

export async function exportUserData(userId: string) {
  await ensureChatSchema();
  const conversations = await listConversations(userId);
  const withMessages = await Promise.all(
    conversations.map(async (c) => ({ ...c, messages: await listMessages(c.id) })),
  );
  return {
    exportedAt: new Date().toISOString(),
    user: userId,
    customInstructions: await getCustomInstructions(userId),
    prefs: await getPrefs(userId),
    memory: await listMemory(userId),
    projects: await listProjects(userId),
    conversations: withMessages,
  };
}

// Derive a short title from the first user turn (like the desktop does on first message).
export function deriveTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 48 ? `${t.slice(0, 48)}…` : t || 'New chat';
}
