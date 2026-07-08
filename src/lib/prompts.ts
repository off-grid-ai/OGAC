import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { promptLibrary } from '@/db/schema';
// Pure {{variable}} template helpers live in a client-safe module (no DB import) so client components
// can use them without bundling `pg`. Re-exported here for existing server callers.
import { extractVariables, renderPromptTemplate } from '@/lib/prompt-template';

export { extractVariables, renderPromptTemplate };

// Prompt library server logic — a personal/org library of reusable prompt texts. Adjacent to but
// distinct from skills (which are assistants). Tables are created idempotently on first use, copying
// the chat module's memoized ensure-schema pattern so the module deploys over SSH with no migration
// step and concurrent cold-start DDL can't 500.

let ensurePromise: Promise<void> | null = null;
export async function ensurePromptSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS prompt_library (
        id text PRIMARY KEY, title text NOT NULL DEFAULT 'Untitled prompt',
        content text NOT NULL DEFAULT '', tags jsonb NOT NULL DEFAULT '[]',
        variables jsonb NOT NULL DEFAULT '[]', owner text NOT NULL DEFAULT '',
        visibility text NOT NULL DEFAULT 'private', uses integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS prompt_library_owner_idx ON prompt_library (owner, updated_at);`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

const rid = () => crypto.randomUUID();

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const v = t.trim().toLowerCase().slice(0, 40);
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 20);
}

// Prompts visible to a user: their own private prompts + every org-visible prompt. Optional
// full-text (title/content) and tag filters.
export async function listPrompts(owner: string, opts: { q?: string; tag?: string } = {}) {
  await ensurePromptSchema();
  const visible = or(
    eq(promptLibrary.visibility, 'org'),
    eq(promptLibrary.owner, owner),
  );
  const conds = [visible];
  const q = opts.q?.trim();
  if (q) {
    const like = `%${q}%`;
    conds.push(or(ilike(promptLibrary.title, like), ilike(promptLibrary.content, like))!);
  }
  if (opts.tag?.trim()) {
    // tags is a jsonb array of strings — match membership.
    conds.push(sql`${promptLibrary.tags} ? ${opts.tag.trim().toLowerCase()}`);
  }
  return db
    .select()
    .from(promptLibrary)
    .where(and(...conds))
    .orderBy(desc(promptLibrary.updatedAt));
}

export async function getPrompt(id: string) {
  await ensurePromptSchema();
  const [p] = await db.select().from(promptLibrary).where(eq(promptLibrary.id, id));
  return p ?? null;
}

export async function createPrompt(
  owner: string,
  p: { title?: string; content?: string; tags?: unknown; visibility?: string },
) {
  await ensurePromptSchema();
  const id = rid();
  const content = (p.content ?? '').slice(0, 20000);
  await db.insert(promptLibrary).values({
    id,
    title: (p.title ?? 'Untitled prompt').slice(0, 200),
    content,
    tags: cleanTags(p.tags),
    variables: extractVariables(content),
    owner,
    visibility: p.visibility === 'org' ? 'org' : 'private',
  });
  return id;
}

export async function updatePrompt(
  id: string,
  patch: { title?: string; content?: string; tags?: unknown; visibility?: string },
) {
  await ensurePromptSchema();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title.slice(0, 200);
  if (patch.content !== undefined) {
    const content = patch.content.slice(0, 20000);
    set.content = content;
    set.variables = extractVariables(content);
  }
  if (patch.tags !== undefined) set.tags = cleanTags(patch.tags);
  if (patch.visibility !== undefined) set.visibility = patch.visibility === 'org' ? 'org' : 'private';
  await db.update(promptLibrary).set(set).where(eq(promptLibrary.id, id));
}

export async function deletePrompt(id: string) {
  await ensurePromptSchema();
  await db.delete(promptLibrary).where(eq(promptLibrary.id, id));
}

export async function incrementUses(id: string) {
  await ensurePromptSchema();
  await db
    .update(promptLibrary)
    .set({ uses: sql`${promptLibrary.uses} + 1` })
    .where(eq(promptLibrary.id, id));
}
