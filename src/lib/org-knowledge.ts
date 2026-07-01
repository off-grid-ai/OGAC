import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { orgKnowledgeChunks, orgKnowledgeCollections, orgKnowledgeDocs } from '@/db/schema';

// Organization-wide knowledge base — the on-prem answer to "Ask Your Org" / "Company Knowledge".
// An admin-curated shared corpus, indexed once via the gateway's /v1/embeddings (384-dim MiniLM),
// with PERMISSION-AWARE retrieval: a user only ever searches collections whose allowedRoles admit
// their role. Parallel to lib/rag.ts (per-project RAG) — same chunk→embed→cosine pipeline, same
// <knowledge_base> output format — but org-scoped and RBAC-gated. Tables are ensured idempotently
// so it deploys over SSH with no migration step (mirrors lib/chat.ts).

const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';

let ensurePromise: Promise<void> | null = null;
async function ensureSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS org_knowledge_collections (
      id text PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '',
      allowed_roles jsonb NOT NULL DEFAULT '[]'::jsonb, created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now());
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS org_knowledge_docs (
      id text PRIMARY KEY, collection_id text NOT NULL, name text NOT NULL,
      kind text NOT NULL DEFAULT 'text', size integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now());
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS org_knowledge_chunks (
      id text PRIMARY KEY, doc_id text NOT NULL, collection_id text NOT NULL, content text NOT NULL,
      position integer NOT NULL DEFAULT 0, embedding jsonb);
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS org_knowledge_chunks_col_idx ON org_knowledge_chunks (collection_id);`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS org_knowledge_docs_col_idx ON org_knowledge_docs (collection_id);`,
  );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

// Chunk text ~600 words with 120 overlap (desktop/rag.ts defaults; ~4 chars/token).
function chunkText(text: string, chunkSize = 600, overlap = 120): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const step = chunkSize - overlap;
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += step) {
    const slice = words.slice(i, i + chunkSize).join(' ');
    if (slice.trim().length > 20) chunks.push(slice);
    if (i + chunkSize >= words.length) break;
  }
  return chunks.length ? chunks : [text.trim()].filter(Boolean);
}

async function embed(input: string | string[]): Promise<number[][]> {
  const r = await fetch(`${GATEWAY_URL}/v1/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`embeddings ${r.status}`);
  const data = await r.json();
  return (data?.data ?? []).map((d: { embedding: number[] }) => d.embedding);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

const rid = () => crypto.randomUUID();

// A role may retrieve from a collection when it is unrestricted (no allowedRoles) or explicitly
// listed. Admins see everything, matching the console's other RBAC-scoped resources.
function roleMayAccess(role: string, allowedRoles: string[] | null | undefined): boolean {
  if (role === 'admin') return true;
  return !allowedRoles?.length || allowedRoles.includes(role);
}

export type OrgCollection = typeof orgKnowledgeCollections.$inferSelect;

// List collections visible to a role. Admins see all; others see only permitted collections.
export async function listCollections(role: string): Promise<OrgCollection[]> {
  await ensureSchema();
  const rows = await db
    .select()
    .from(orgKnowledgeCollections)
    .orderBy(desc(orgKnowledgeCollections.createdAt));
  return rows.filter((c) => roleMayAccess(role, c.allowedRoles));
}

// Admin-only: create a curated collection with an optional role allow-list.
export async function createCollection(
  createdBy: string,
  input: { name: string; description?: string; allowedRoles?: string[] },
): Promise<string> {
  await ensureSchema();
  const id = rid();
  await db.insert(orgKnowledgeCollections).values({
    id,
    name: String(input.name).slice(0, 200),
    description: String(input.description ?? ''),
    allowedRoles: Array.isArray(input.allowedRoles) ? input.allowedRoles : [],
    createdBy,
  });
  return id;
}

export async function getCollection(id: string): Promise<OrgCollection | null> {
  await ensureSchema();
  const [row] = await db
    .select()
    .from(orgKnowledgeCollections)
    .where(eq(orgKnowledgeCollections.id, id))
    .limit(1);
  return row ?? null;
}

export async function deleteCollection(id: string): Promise<void> {
  await ensureSchema();
  await db.delete(orgKnowledgeChunks).where(eq(orgKnowledgeChunks.collectionId, id));
  await db.delete(orgKnowledgeDocs).where(eq(orgKnowledgeDocs.collectionId, id));
  await db.delete(orgKnowledgeCollections).where(eq(orgKnowledgeCollections.id, id));
}

export async function listDocuments(collectionId: string) {
  await ensureSchema();
  return db
    .select({
      id: orgKnowledgeDocs.id,
      name: orgKnowledgeDocs.name,
      kind: orgKnowledgeDocs.kind,
      size: orgKnowledgeDocs.size,
      createdAt: orgKnowledgeDocs.createdAt,
    })
    .from(orgKnowledgeDocs)
    .where(eq(orgKnowledgeDocs.collectionId, collectionId))
    .orderBy(desc(orgKnowledgeDocs.createdAt));
}

// Add a document to a collection: chunk → embed (via gateway) → store.
export async function addDocument(
  collectionId: string,
  name: string,
  content: string,
): Promise<{ id: string; chunks: number }> {
  await ensureSchema();
  const docId = rid();
  const pieces = chunkText(content);
  const vectors = await embed(pieces);
  await db.insert(orgKnowledgeDocs).values({
    id: docId,
    collectionId,
    name: name.slice(0, 200),
    kind: 'text',
    size: content.length,
  });
  if (pieces.length) {
    await db.insert(orgKnowledgeChunks).values(
      pieces.map((c, i) => ({
        id: rid(),
        docId,
        collectionId,
        content: c,
        position: i,
        embedding: vectors[i] ?? null,
      })),
    );
  }
  return { id: docId, chunks: pieces.length };
}

export async function deleteDocument(docId: string): Promise<void> {
  await ensureSchema();
  await db.delete(orgKnowledgeChunks).where(eq(orgKnowledgeChunks.docId, docId));
  await db.delete(orgKnowledgeDocs).where(eq(orgKnowledgeDocs.id, docId));
}

export interface Citation {
  name: string;
  position: number;
  score: number;
  collection: string;
}

// Permission-aware retrieval — the whole point of this module. Resolve the collections the role
// may access, search only their chunks by cosine similarity, and format the same <knowledge_base>
// block rag.ts uses (with [Source: …] tags for citation). Returns empty when nothing is permitted.
// eslint-disable-next-line complexity
export async function retrieve(
  query: string,
  role: string,
  topK = 6,
): Promise<{ context: string; citations: Citation[] }> {
  await ensureSchema();
  const collections = await listCollections(role);
  if (!collections.length) return { context: '', citations: [] };
  const allowedIds = collections.map((c) => c.id);
  const colNames = new Map(collections.map((c) => [c.id, c.name]));

  const rows = await db
    .select({
      content: orgKnowledgeChunks.content,
      position: orgKnowledgeChunks.position,
      embedding: orgKnowledgeChunks.embedding,
      docId: orgKnowledgeChunks.docId,
      collectionId: orgKnowledgeChunks.collectionId,
    })
    .from(orgKnowledgeChunks)
    .where(inArray(orgKnowledgeChunks.collectionId, allowedIds));
  if (!rows.length) return { context: '', citations: [] };

  const qVecs = await embed(query);
  const qVec = qVecs[0];
  if (!qVec) return { context: '', citations: [] }; // embedding unavailable → no retrieval, no crash
  const docIds = [...new Set(rows.map((r) => r.docId))];
  const docNames = new Map<string, string>();
  for (const d of await db
    .select({ id: orgKnowledgeDocs.id, name: orgKnowledgeDocs.name })
    .from(orgKnowledgeDocs)
    .where(inArray(orgKnowledgeDocs.id, docIds))) {
    docNames.set(d.id, d.name);
  }

  const scored = rows
    .filter((r) => Array.isArray(r.embedding))
    .map((r) => ({
      name: docNames.get(r.docId) ?? 'document',
      collection: colNames.get(r.collectionId) ?? 'knowledge',
      content: r.content,
      position: r.position,
      score: cosine(qVec, r.embedding as number[]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  if (!scored.length) return { context: '', citations: [] };
  const context =
    '<knowledge_base>\n' +
    'The following excerpts are from your organization-wide knowledge base (only sources your ' +
    'role is permitted to see). Use them to answer and cite the source filename when you do.\n' +
    scored
      .map((c) => `[Source: ${c.name} — ${c.collection} (part ${c.position + 1})]\n${c.content}`)
      .join('\n---\n') +
    '\n</knowledge_base>';
  const citations = scored.map((c) => ({
    name: c.name,
    position: c.position,
    score: c.score,
    collection: c.collection,
  }));
  return { context, citations };
}
