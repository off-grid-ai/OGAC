import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { chatConversations, chatMessages, chatProjects, chatSettings } from '@/db/schema';

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
  ensured = true;
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

export async function createConversation(userId: string, projectId?: string | null) {
  await ensureChatSchema();
  const id = rid();
  await db.insert(chatConversations).values({ id, userId, projectId: projectId ?? null });
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

// Derive a short title from the first user turn (like the desktop does on first message).
export function deriveTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 48 ? `${t.slice(0, 48)}…` : t || 'New chat';
}
