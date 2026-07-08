import { desc, eq, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { promptPartials } from '@/db/schema';
import { extractVariables } from '@/lib/prompt-template';

// Prompt PARTIALS server logic — reusable prompt fragments composed into prompts via `{{>name}}`.
// Adjacent to the prompt library (prompts.ts). The pure inlining lives in prompt-template.ts; this is
// the I/O layer: CRUD + name resolution. The table is created idempotently on first use (same memoized
// ensure-schema pattern as prompts.ts) so the module deploys over SSH with no migration step.

let ensurePromise: Promise<void> | null = null;
export async function ensurePromptPartialSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS prompt_partials (
        id text PRIMARY KEY, name text NOT NULL, title text NOT NULL DEFAULT '',
        content text NOT NULL DEFAULT '', owner text NOT NULL DEFAULT '',
        visibility text NOT NULL DEFAULT 'private',
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS prompt_partials_owner_idx ON prompt_partials (owner, updated_at);`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS prompt_partials_name_idx ON prompt_partials (name);`,
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

const rid = () => crypto.randomUUID();

// Slug a partial name into the reference key grammar: lowercase, word/dot/dash only, so it round-trips
// through the {{>name}} token regex ([\w.-]+). Empty → a stable fallback.
export function slugPartialName(raw: unknown): string {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w.-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return s || 'partial';
}

export type PartialRow = typeof promptPartials.$inferSelect;

// Partials visible to a user: their own private partials + every org-visible partial.
export async function listPartials(owner: string): Promise<PartialRow[]> {
  await ensurePromptPartialSchema();
  return db
    .select()
    .from(promptPartials)
    .where(or(eq(promptPartials.visibility, 'org'), eq(promptPartials.owner, owner)))
    .orderBy(desc(promptPartials.updatedAt));
}

export async function getPartial(id: string): Promise<PartialRow | null> {
  await ensurePromptPartialSchema();
  const [p] = await db.select().from(promptPartials).where(eq(promptPartials.id, id));
  return p ?? null;
}

/**
 * Resolve the name→body map a prompt's `{{>name}}` refs inline against, scoped to what the caller may
 * see (their private partials + org-visible). On a name collision (a private + an org partial share a
 * name) the caller's OWN private partial wins — most-specific-to-the-user.
 */
export async function resolvePartialMap(owner: string): Promise<Record<string, string>> {
  const rows = await listPartials(owner);
  const map: Record<string, string> = {};
  // listPartials returns org + own; apply org first, then own, so own overrides on a name clash.
  for (const r of rows.filter((r) => r.owner !== owner)) map[r.name] = r.content;
  for (const r of rows.filter((r) => r.owner === owner)) map[r.name] = r.content;
  return map;
}

export async function createPartial(
  owner: string,
  p: { name?: string; title?: string; content?: string; visibility?: string },
): Promise<{ id: string; name: string }> {
  await ensurePromptPartialSchema();
  const id = rid();
  const name = slugPartialName(p.name || p.title);
  await db.insert(promptPartials).values({
    id,
    name,
    title: (p.title ?? '').slice(0, 200),
    content: (p.content ?? '').slice(0, 20000),
    owner,
    visibility: p.visibility === 'org' ? 'org' : 'private',
  });
  return { id, name };
}

export async function updatePartial(
  id: string,
  patch: { name?: string; title?: string; content?: string; visibility?: string },
): Promise<void> {
  await ensurePromptPartialSchema();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = slugPartialName(patch.name);
  if (patch.title !== undefined) set.title = patch.title.slice(0, 200);
  if (patch.content !== undefined) set.content = patch.content.slice(0, 20000);
  if (patch.visibility !== undefined) {
    set.visibility = patch.visibility === 'org' ? 'org' : 'private';
  }
  await db.update(promptPartials).set(set).where(eq(promptPartials.id, id));
}

export async function deletePartial(id: string): Promise<void> {
  await ensurePromptPartialSchema();
  await db.delete(promptPartials).where(eq(promptPartials.id, id));
}

/** The distinct {{variables}} a partial exposes (surfaced in the UI so the composer knows what it needs). */
export function partialVariables(content: string): string[] {
  return extractVariables(content);
}
