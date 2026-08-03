import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { chatChunks, chatDocuments, chatProjects } from '@/db/schema';

// Knowledgebase / RAG — ports Off Grid AI Desktop's chunk→embed→retrieve pipeline to the console,
// using the on-prem gateway's /v1/embeddings (384-dim MiniLM) instead of an in-process model.

import { embed } from '@/lib/embeddings';
import { chunkText } from '@/lib/text-chunks';

let ensurePromise: Promise<void> | null = null;
async function ensureRagSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_documents (
      id text PRIMARY KEY, project_id text NOT NULL, user_id text NOT NULL, name text NOT NULL,
      kind text NOT NULL DEFAULT 'text', size integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now());
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_chunks (
      id text PRIMARY KEY, doc_id text NOT NULL, project_id text NOT NULL, content text NOT NULL,
      position integer NOT NULL DEFAULT 0, embedding jsonb);
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_chunks_proj_idx ON chat_chunks (project_id);`);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
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

export async function listDocuments(projectId: string) {
  await ensureRagSchema();
  return db
    .select({
      id: chatDocuments.id,
      name: chatDocuments.name,
      kind: chatDocuments.kind,
      size: chatDocuments.size,
      createdAt: chatDocuments.createdAt,
    })
    .from(chatDocuments)
    .where(eq(chatDocuments.projectId, projectId))
    .orderBy(desc(chatDocuments.createdAt));
}

export async function addDocument(
  userId: string,
  projectId: string,
  name: string,
  content: string,
): Promise<{ id: string; chunks: number }> {
  await ensureRagSchema();
  const docId = rid();
  const pieces = chunkText(content);
  const vectors = await embed(pieces);
  await db.insert(chatDocuments).values({
    id: docId,
    projectId,
    userId,
    name: name.slice(0, 200),
    kind: 'text',
    size: content.length,
  });
  if (pieces.length) {
    const rows = pieces.map((content, i) => ({
      id: rid(),
      docId,
      projectId,
      content,
      position: i,
      embedding: vectors[i] ?? null,
    }));
    await db.insert(chatChunks).values(rows);
    // Same subject index as the org corpus — a project's knowledge is just as erasable, and leaving it
    // out would mean an erasure that reports success while a copy survives in a project.
    try {
      const { indexChunkSubjects } = await import('@/lib/subject-index-store');
      const { orgIdForProject } = await import('@/lib/rag-org');
      await indexChunkSubjects(
        await orgIdForProject(projectId),
        'project',
        rows.map((r) => ({ chunkId: r.id, docId, containerId: projectId, content: r.content })),
      );
    } catch (e) {
      console.error('[subject-index] project document not indexed for erasure:', (e as Error).message);
    }
  }
  return { id: docId, chunks: pieces.length };
}

export async function deleteDocument(docId: string) {
  await ensureRagSchema();
  await db.delete(chatChunks).where(eq(chatChunks.docId, docId));
  await db.delete(chatDocuments).where(eq(chatDocuments.id, docId));
}

export interface Citation {
  name: string;
  position: number;
  score: number;
}

const EMPTY_RETRIEVAL: { context: string; citations: Citation[] } = { context: '', citations: [] };

/**
 * PURE tenant-isolation rule for the RAG read (zero-I/O, unit-testable). A project's chunks may be
 * retrieved ONLY when the project belongs to the caller's org. `projectOrgId` is the org the target
 * project is owned by (null ⇒ project row not found), `callerOrgId` is currentOrgId() at the request.
 * Returns true iff the read is same-tenant. This is the ONE authority the retrieve() adapter consults
 * so "a chat in org A can never retrieve org B's knowledge chunks" is a single, testable decision.
 */
export function ragOrgAllows(projectOrgId: string | null | undefined, callerOrgId: string): boolean {
  if (!projectOrgId) return false; // unknown/missing project ⇒ deny (fail-closed, no cross-tenant leak)
  return projectOrgId === callerOrgId;
}

/** Look up the org that owns a chat project (null when the project row does not exist). */
async function projectOrgId(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: chatProjects.orgId })
    .from(chatProjects)
    .where(eq(chatProjects.id, projectId))
    .limit(1);
  return row?.orgId ?? null;
}

// Retrieve the top-k most relevant chunks for a query within a project, and format the
// <knowledge_base> block the desktop uses (with [Source: name (part n)] tags for citation).
// `opts.docId` narrows retrieval to a single document within the project (used by an @-mention that
// references one specific KB doc); omit it to search the whole project.
//
// TENANT ISOLATION (SECURITY #236 / G-ADV-CHAT-1): `opts.orgId` is the caller's currentOrgId(). The
// read is gated by ragOrgAllows() — chunks are returned ONLY when the target project belongs to that
// org, so a chat in org A can never retrieve org B's knowledge chunks. A cross-org (or unknown)
// project yields the empty result, never another tenant's data. orgId is REQUIRED in practice; it is
// typed optional only so legacy callers compile, and an omitted orgId means "no org context" which
// fails the ragOrgAllows check for any real project (deny) unless the project is unowned/'default'.
export async function retrieve(
  projectId: string,
  query: string,
  topK = 6,
  opts: { docId?: string; orgId?: string } = {},
): Promise<{ context: string; citations: Citation[] }> {
  await ensureRagSchema();
  // HARD tenant gate BEFORE any chunk read: the project must belong to the caller's org.
  if (!ragOrgAllows(await projectOrgId(projectId), opts.orgId ?? '')) return EMPTY_RETRIEVAL;
  const scope = opts.docId
    ? and(eq(chatChunks.projectId, projectId), eq(chatChunks.docId, opts.docId))
    : eq(chatChunks.projectId, projectId);
  const rows = await db
    .select({
      content: chatChunks.content,
      position: chatChunks.position,
      embedding: chatChunks.embedding,
      docId: chatChunks.docId,
    })
    .from(chatChunks)
    .where(scope);
  if (!rows.length) return { context: '', citations: [] };

  const qVecs = await embed(query);
  const qVec = qVecs[0];
  if (!qVec) return { context: '', citations: [] }; // embedding unavailable → no retrieval, no crash
  const docNames = new Map<string, string>();
  for (const d of await db
    .select({ id: chatDocuments.id, name: chatDocuments.name })
    .from(chatDocuments)
    .where(eq(chatDocuments.projectId, projectId))) {
    docNames.set(d.id, d.name);
  }

  const scored = rows
    .filter((r) => Array.isArray(r.embedding))
    .map((r) => ({
      // No fabricated 'document' name, and docId is CARRIED — it was selected into `rows` above and
      // then dropped here, so a project-grounded citation had no identity to link to. Same pair of
      // defects as retrieveOrgKnowledge had.
      docId: r.docId,
      name: docNames.get(r.docId) ?? '',
      content: r.content,
      position: r.position,
      score: cosine(qVec, r.embedding as number[]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  if (!scored.length) return { context: '', citations: [] };
  const context =
    '<knowledge_base>\n' +
    "The following excerpts are from the project's knowledge base. Use them to answer and cite " +
    'the source filename when you do.\n' +
    scored.map((c) => `[Source: ${c.name} (part ${c.position + 1})]\n${c.content}`).join('\n---\n') +
    '\n</knowledge_base>';
  const citations = scored.map((c) => ({
    name: c.name,
    position: c.position,
    score: c.score,
    docId: c.docId,
    // The project is where a reviewer opens this document, so it is the row's destination.
    projectId,
  }));
  return { context, citations };
}
