import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { chatConversations, chatMessages, chatProjects } from '@/db/schema';

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
  ensured = true;
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
