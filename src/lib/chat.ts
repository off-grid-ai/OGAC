import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  chatArtifacts,
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

let ensured = false;
export async function ensureChatSchema(): Promise<void> {
  if (ensured) return;
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
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_prefs (
      user_id text PRIMARY KEY, prefs jsonb NOT NULL DEFAULT '{}',
      updated_at timestamptz NOT NULL DEFAULT now());
  `);
  ensured = true;
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

export async function listMessages(conversationId: string) {
  await ensureChatSchema();
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(asc(chatMessages.createdAt));
}

export async function addMessage(m: {
  conversationId: string;
  role: string;
  content: string;
  reasoning?: string | null;
  images?: string[] | null;
  citations?: { name: string; position: number; score: number }[] | null;
}) {
  await ensureChatSchema();
  const id = rid();
  await db.insert(chatMessages).values({
    id,
    conversationId: m.conversationId,
    role: m.role,
    content: m.content,
    reasoning: m.reasoning ?? null,
    images: m.images ?? null,
    citations: m.citations ?? null,
  });
  await db
    .update(chatConversations)
    .set({ updatedAt: new Date() })
    .where(eq(chatConversations.id, m.conversationId));
  return id;
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
  return db
    .select()
    .from(chatProjects)
    .where(eq(chatProjects.userId, userId))
    .orderBy(desc(chatProjects.updatedAt));
}

export async function createProject(userId: string, name: string, systemPrompt = '') {
  await ensureChatSchema();
  const id = rid();
  await db.insert(chatProjects).values({ id, userId, name: name.slice(0, 120), systemPrompt });
  return id;
}

export async function updateProject(
  userId: string,
  id: string,
  patch: { name?: string; description?: string; systemPrompt?: string },
) {
  await ensureChatSchema();
  await db
    .update(chatProjects)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(chatProjects.id, id), eq(chatProjects.userId, userId)));
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
export async function listArtifacts(userId: string) {
  await ensureChatSchema();
  return db
    .select()
    .from(chatArtifacts)
    .where(eq(chatArtifacts.userId, userId))
    .orderBy(desc(chatArtifacts.createdAt));
}

export async function saveArtifact(
  userId: string,
  a: { kind: string; code: string; language?: string | null; title?: string; conversationId?: string | null },
) {
  await ensureChatSchema();
  const code = String(a.code ?? '');
  // De-dupe: if the same user already saved an identical (kind, code), return it instead of piling up.
  const [dup] = await db
    .select({ id: chatArtifacts.id })
    .from(chatArtifacts)
    .where(and(eq(chatArtifacts.userId, userId), eq(chatArtifacts.kind, a.kind), eq(chatArtifacts.code, code)))
    .limit(1);
  if (dup) return dup.id;
  const id = rid();
  await db.insert(chatArtifacts).values({
    id,
    userId,
    kind: a.kind,
    code,
    language: a.language ?? null,
    title: (a.title ?? 'Untitled artifact').slice(0, 200),
    conversationId: a.conversationId ?? null,
  });
  return id;
}

export async function deleteArtifact(userId: string, id: string) {
  await ensureChatSchema();
  await db.delete(chatArtifacts).where(and(eq(chatArtifacts.id, id), eq(chatArtifacts.userId, userId)));
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
