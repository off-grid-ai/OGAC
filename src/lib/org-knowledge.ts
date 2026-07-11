import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { orgKnowledgeChunks, orgKnowledgeCollections, orgKnowledgeDocs } from '@/db/schema';
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';
import { effectiveBaseRole } from '@/lib/role-permissions';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// Organization-wide knowledge base — the on-prem answer to "Ask Your Org" / "Company Knowledge".
// An admin-curated shared corpus, indexed once via the gateway's /v1/embeddings (384-dim MiniLM),
// with PERMISSION-AWARE retrieval: a user only ever searches collections whose allowedRoles admit
// their role. Parallel to lib/rag.ts (per-project RAG) — same chunk→embed→cosine pipeline, same
// <knowledge_base> output format — but org-scoped and RBAC-gated. Tables are ensured idempotently
// so it deploys over SSH with no migration step (mirrors lib/chat.ts).


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
  // Self-migrate the file-reference columns (the original upload lives in SeaweedFS) so a
  // deploy needs no separate migration step — matches the CREATE-IF-NOT-EXISTS pattern above.
  await db.execute(sql`ALTER TABLE org_knowledge_docs ADD COLUMN IF NOT EXISTS file_url text;`);
  await db.execute(sql`ALTER TABLE org_knowledge_docs ADD COLUMN IF NOT EXISTS mime text;`);
  // T2 multi-tenant org-scoping: the collection carries the tenant boundary; docs/chunks inherit it
  // through their collection. Self-migrated (same pattern) so the store's org filter never queries a
  // missing column, whether the table pre-existed the T2 change or is created fresh here.
  await db.execute(
    sql`ALTER TABLE org_knowledge_collections ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS org_knowledge_collections_org_idx ON org_knowledge_collections (org_id);`,
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
    headers: gatewayHeaders({ 'content-type': 'application/json' }),
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
// listed for any of its identities (its own name or, for a custom role, its inherited base role).
// Admins see everything, matching the console's other RBAC-scoped resources.
function roleMayAccess(identities: string[], allowedRoles: string[] | null | undefined): boolean {
  if (identities.includes('admin')) return true;
  return !allowedRoles?.length || allowedRoles.some((r) => identities.includes(r));
}

export type OrgCollection = typeof orgKnowledgeCollections.$inferSelect;

// The identities a role is granted under: its own name plus, for a custom role, its based_on role.
async function roleIdentities(role: string): Promise<string[]> {
  const base = await effectiveBaseRole(role);
  return Array.from(new Set([role, base]));
}

// List collections visible to a role, WITHIN the caller's org. Two layers of scoping: org isolation
// (a tenant never sees another org's collections) then role permission (admins see all of their
// org's; others see only permitted ones). Custom roles inherit their based_on role's grants.
export async function listCollections(
  role: string,
  orgId: string = DEFAULT_ORG,
): Promise<OrgCollection[]> {
  await ensureSchema();
  const identities = await roleIdentities(role);
  const rows = await db
    .select()
    .from(orgKnowledgeCollections)
    .where(eq(orgKnowledgeCollections.orgId, orgId))
    .orderBy(desc(orgKnowledgeCollections.createdAt));
  return rows.filter((c) => roleMayAccess(identities, c.allowedRoles));
}

// Admin-only: create a curated collection for the caller's org with an optional role allow-list.
//
// `input.id` (optional) lets a SEED pass a DETERMINISTIC id so a re-run is idempotent: the insert
// is ON CONFLICT DO NOTHING on the primary key, and we return the id that now owns the row (the
// existing one on a conflict). Interactive creates omit `id` and get a random one, as before. This
// is what stops the demo seed from minting a fresh "Insurance Policies & SOPs" every run.
export async function createCollection(
  createdBy: string,
  input: { name: string; description?: string; allowedRoles?: string[]; id?: string },
  orgId: string = DEFAULT_ORG,
): Promise<string> {
  await ensureSchema();
  const id = input.id ?? rid();
  await db
    .insert(orgKnowledgeCollections)
    .values({
      id,
      orgId,
      name: String(input.name).slice(0, 200),
      description: String(input.description ?? ''),
      allowedRoles: Array.isArray(input.allowedRoles) ? input.allowedRoles : [],
      createdBy,
    })
    .onConflictDoNothing({ target: orgKnowledgeCollections.id });
  return id;
}

// Get a collection, constrained to the caller's org — a user in org A can never read org B's row.
export async function getCollection(
  id: string,
  orgId: string = DEFAULT_ORG,
): Promise<OrgCollection | null> {
  await ensureSchema();
  const [row] = await db
    .select()
    .from(orgKnowledgeCollections)
    .where(and(eq(orgKnowledgeCollections.id, id), eq(orgKnowledgeCollections.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function deleteCollection(id: string, orgId: string = DEFAULT_ORG): Promise<void> {
  await ensureSchema();
  // Only touch the collection (and cascade its docs/chunks) when it's the caller's own.
  const [own] = await db
    .select({ id: orgKnowledgeCollections.id })
    .from(orgKnowledgeCollections)
    .where(and(eq(orgKnowledgeCollections.id, id), eq(orgKnowledgeCollections.orgId, orgId)))
    .limit(1);
  if (!own) return;
  await db.delete(orgKnowledgeChunks).where(eq(orgKnowledgeChunks.collectionId, id));
  await db.delete(orgKnowledgeDocs).where(eq(orgKnowledgeDocs.collectionId, id));
  await db.delete(orgKnowledgeCollections).where(eq(orgKnowledgeCollections.id, id));
}

// Documents inherit their collection's org — list them only when the collection is the caller's.
export async function listDocuments(collectionId: string, orgId: string = DEFAULT_ORG) {
  await ensureSchema();
  const col = await getCollection(collectionId, orgId);
  if (!col) return [];
  return db
    .select({
      id: orgKnowledgeDocs.id,
      name: orgKnowledgeDocs.name,
      kind: orgKnowledgeDocs.kind,
      size: orgKnowledgeDocs.size,
      fileUrl: orgKnowledgeDocs.fileUrl,
      mime: orgKnowledgeDocs.mime,
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
  // Reference to the original uploaded file in SeaweedFS (the single file-storage layer), so
  // the user can view/download what they uploaded. Omitted for docs added as raw pasted text.
  file?: { url: string; mime: string },
  orgId: string = DEFAULT_ORG,
): Promise<{ id: string; chunks: number }> {
  await ensureSchema();
  // Parent-scope guard: refuse to index into a collection that isn't the caller's org.
  const col = await getCollection(collectionId, orgId);
  if (!col) throw new Error('collection not found');
  const docId = rid();
  const pieces = chunkText(content);
  const vectors = await embed(pieces);
  await db.insert(orgKnowledgeDocs).values({
    id: docId,
    collectionId,
    name: name.slice(0, 200),
    kind: file ? 'file' : 'text',
    size: content.length,
    fileUrl: file?.url ?? null,
    mime: file?.mime ?? null,
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

export async function deleteDocument(docId: string, orgId: string = DEFAULT_ORG): Promise<void> {
  await ensureSchema();
  // The doc has no org column — resolve its collection and verify that collection is the caller's
  // org before deleting, so a tenant can't delete another org's document by guessing its id.
  const [doc] = await db
    .select({ collectionId: orgKnowledgeDocs.collectionId })
    .from(orgKnowledgeDocs)
    .where(eq(orgKnowledgeDocs.id, docId))
    .limit(1);
  if (!doc) return;
  const col = await getCollection(doc.collectionId, orgId);
  if (!col) return;
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
  orgId: string = DEFAULT_ORG,
): Promise<{ context: string; citations: Citation[] }> {
  await ensureSchema();
  // listCollections already double-scopes by org + role, so the allowedIds below can only ever be
  // this org's collections — the chunk search can never reach another tenant's knowledge.
  const collections = await listCollections(role, orgId);
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
