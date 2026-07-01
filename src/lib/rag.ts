import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { chatChunks, chatDocuments } from '@/db/schema';

// Knowledgebase / RAG — ports Off Grid AI Desktop's chunk→embed→retrieve pipeline to the console,
// using the on-prem gateway's /v1/embeddings (384-dim MiniLM) instead of an in-process model.

const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';

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

// Chunk text ~600 tokens with 120 overlap (desktop defaults; ~4 chars/token).
function chunkText(text: string, chunkSize = 600, overlap = 120): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const wordsPerChunk = chunkSize;
  const step = wordsPerChunk - overlap;
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += step) {
    const slice = words.slice(i, i + wordsPerChunk).join(' ');
    if (slice.trim().length > 20) chunks.push(slice);
    if (i + wordsPerChunk >= words.length) break;
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
    await db.insert(chatChunks).values(
      pieces.map((content, i) => ({
        id: rid(),
        docId,
        projectId,
        content,
        position: i,
        embedding: vectors[i] ?? null,
      })),
    );
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

// Retrieve the top-k most relevant chunks for a query within a project, and format the
// <knowledge_base> block the desktop uses (with [Source: name (part n)] tags for citation).
export async function retrieve(
  projectId: string,
  query: string,
  topK = 6,
): Promise<{ context: string; citations: Citation[] }> {
  await ensureRagSchema();
  const rows = await db
    .select({
      content: chatChunks.content,
      position: chatChunks.position,
      embedding: chatChunks.embedding,
      docId: chatChunks.docId,
    })
    .from(chatChunks)
    .where(eq(chatChunks.projectId, projectId));
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
      name: docNames.get(r.docId) ?? 'document',
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
  const citations = scored.map((c) => ({ name: c.name, position: c.position, score: c.score }));
  return { context, citations };
}
