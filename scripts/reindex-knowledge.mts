// ─── Replace placeholder / missing knowledge text with the real corpus ─────────────────────────────
//
// Run ON the box (tsx, reads .env.local) — it needs the DB and the gateway's embeddings endpoint:
//
//   cd /Users/admin/offgrid/console && set -a; . ./.env.local; set +a; \
//     npx tsx scripts/reindex-knowledge.mts [--dry]
//
// WHY IT GOES THROUGH THE PRODUCT'S OWN PATH. It would be quicker to INSERT chunks with SQL, and that is
// exactly how the current state was produced: rows that look indexed, with no vector, so retrieval finds
// nothing while the list shows a healthy document count. This re-chunks with `chunkText` and re-embeds
// with `embed` — the same two functions the upload route calls — so a document that appears here is a
// document the product can actually retrieve and cite. If the gateway is down, this fails loudly instead
// of writing null vectors.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
  chatChunks,
  chatDocuments,
  orgKnowledgeChunks,
  orgKnowledgeDocs,
} from '../src/db/schema.ts';
import { embed } from '../src/lib/embeddings.ts';
import { chunkText } from '../src/lib/text-chunks.ts';
import { PROJECT_DOCS } from './knowledge-corpus-projects.ts';
import { ORG_DOCS, ORG_DOC_FIXES } from './knowledge-corpus-org.ts';

const DRY = process.argv.includes('--dry');
const rid = () => crypto.randomUUID();

function log(...args: unknown[]) {
  console.log(...args);
}

// ── project documents (chat_documents / chat_chunks) ─────────────────────────────────────────────────
async function reindexProjectDocs() {
  const names = Object.keys(PROJECT_DOCS);
  const docs = await db
    .select({ id: chatDocuments.id, projectId: chatDocuments.projectId, name: chatDocuments.name })
    .from(chatDocuments)
    .where(inArray(chatDocuments.name, names));
  log(`project documents matched: ${docs.length} rows across ${new Set(docs.map((d) => d.name)).size} names`);

  // One embed call per distinct document, reused across every project that has a copy of it — the text
  // is identical, so embedding it once per project would only spend gateway time.
  const vectorsByName = new Map<string, { pieces: string[]; vectors: number[][] }>();
  for (const name of new Set(docs.map((d) => d.name))) {
    const pieces = chunkText(PROJECT_DOCS[name]);
    const vectors = DRY ? pieces.map(() => []) : await embed(pieces);
    if (!DRY && vectors.length !== pieces.length) {
      throw new Error(`embed returned ${vectors.length} vectors for ${pieces.length} chunks (${name})`);
    }
    vectorsByName.set(name, { pieces, vectors });
    log(`  embedded "${name}" → ${pieces.length} chunks`);
  }

  for (const doc of docs) {
    const { pieces, vectors } = vectorsByName.get(doc.name)!;
    if (DRY) continue;
    await db.delete(chatChunks).where(eq(chatChunks.docId, doc.id));
    await db.insert(chatChunks).values(
      pieces.map((content, i) => ({
        id: rid(),
        docId: doc.id,
        projectId: doc.projectId,
        content,
        position: i,
        embedding: vectors[i] ?? null,
      })),
    );
    await db
      .update(chatDocuments)
      .set({ size: PROJECT_DOCS[doc.name].length })
      .where(eq(chatDocuments.id, doc.id));
  }
  log(`project documents reindexed: ${DRY ? 0 : docs.length}`);
}

// ── org knowledge documents (org_knowledge_docs / org_knowledge_chunks) ──────────────────────────────
async function reindexOrgDocs() {
  const names = Object.keys(ORG_DOCS);
  const docs = await db
    .select({
      id: orgKnowledgeDocs.id,
      collectionId: orgKnowledgeDocs.collectionId,
      name: orgKnowledgeDocs.name,
    })
    .from(orgKnowledgeDocs)
    .where(inArray(orgKnowledgeDocs.name, names));
  log(`org documents matched: ${docs.length} rows across ${new Set(docs.map((d) => d.name)).size} names`);

  const vectorsByName = new Map<string, { pieces: string[]; vectors: number[][] }>();
  for (const name of new Set(docs.map((d) => d.name))) {
    const pieces = chunkText(ORG_DOCS[name]);
    const vectors = DRY ? pieces.map(() => []) : await embed(pieces);
    if (!DRY && vectors.length !== pieces.length) {
      throw new Error(`embed returned ${vectors.length} vectors for ${pieces.length} chunks (${name})`);
    }
    vectorsByName.set(name, { pieces, vectors });
    log(`  embedded "${name}" → ${pieces.length} chunks`);
  }

  for (const doc of docs) {
    const { pieces, vectors } = vectorsByName.get(doc.name)!;
    if (DRY) continue;
    await db.delete(orgKnowledgeChunks).where(eq(orgKnowledgeChunks.docId, doc.id));
    await db.insert(orgKnowledgeChunks).values(
      pieces.map((content, i) => ({
        id: rid(),
        docId: doc.id,
        collectionId: doc.collectionId,
        content,
        position: i,
        embedding: vectors[i] ?? null,
      })),
    );
    await db
      .update(orgKnowledgeDocs)
      .set({ size: ORG_DOCS[doc.name].length })
      .where(eq(orgKnowledgeDocs.id, doc.id));
  }
  log(`org documents reindexed: ${DRY ? 0 : docs.length}`);
}

// ── one-line corrections on documents that already have real text ────────────────────────────────────
async function applyFixes() {
  for (const fix of ORG_DOC_FIXES) {
    if (DRY) {
      log(`  would fix "${fix.name}": ${fix.find} → ${fix.replace}`);
      continue;
    }
    const res = await db.execute(sql`
      UPDATE org_knowledge_chunks SET content = replace(content, ${fix.find}, ${fix.replace})
      WHERE doc_id IN (SELECT id FROM org_knowledge_docs WHERE name = ${fix.name})
        AND content LIKE ${'%' + fix.find + '%'}
    `);
    log(`  fixed "${fix.name}" ${fix.find} → ${fix.replace} (rows: ${res.rowCount ?? 0})`);
  }
}

// ── backfill: chunks that have text but NO vector ────────────────────────────────────────────────────
//
// Found while dry-running this: 7 org chunks and 56 project chunks carried real text with `embedding
// IS NULL`. A chunk with no vector is unreachable by cosine retrieval — the document is listed, the text
// is there, and it can never be cited. Same failure-as-emptiness shape as the missing chunks, so it is
// repaired in the same pass rather than left for someone to rediscover.
async function backfillMissingVectors() {
  const projRows = await db
    .select({ id: chatChunks.id, content: chatChunks.content })
    .from(chatChunks)
    .where(sql`${chatChunks.embedding} IS NULL`);
  const orgRows = await db
    .select({ id: orgKnowledgeChunks.id, content: orgKnowledgeChunks.content })
    .from(orgKnowledgeChunks)
    .where(sql`${orgKnowledgeChunks.embedding} IS NULL`);
  log(`\nvectorless chunks — project: ${projRows.length}, org: ${orgRows.length}`);
  if (DRY) return;

  for (const [table, rows] of [
    ['project', projRows],
    ['org', orgRows],
  ] as const) {
    // Batched so one gateway call covers many chunks, and a failure is loud.
    for (let i = 0; i < rows.length; i += 16) {
      const batch = rows.slice(i, i + 16);
      const vectors = await embed(batch.map((r) => r.content));
      if (vectors.length !== batch.length) {
        throw new Error(`embed returned ${vectors.length} vectors for ${batch.length} chunks`);
      }
      for (const [j, row] of batch.entries()) {
        if (table === 'project') {
          await db.update(chatChunks).set({ embedding: vectors[j] }).where(eq(chatChunks.id, row.id));
        } else {
          await db
            .update(orgKnowledgeChunks)
            .set({ embedding: vectors[j] })
            .where(eq(orgKnowledgeChunks.id, row.id));
        }
      }
    }
    log(`  ${table}: ${rows.length} vectors backfilled`);
  }
}

// ── verification: nothing is "done" until the terminal artifact says so ──────────────────────────────
async function verify() {
  const projLeft = await db.execute(sql`
    SELECT count(*)::int AS n FROM chat_chunks WHERE content LIKE 'Extract from %'`);
  const orgEmpty = await db.execute(sql`
    SELECT count(*)::int AS n FROM org_knowledge_docs d
    WHERE NOT EXISTS (SELECT 1 FROM org_knowledge_chunks c WHERE c.doc_id = d.id)`);
  const noVector = await db.execute(sql`
    SELECT count(*)::int AS n FROM org_knowledge_chunks WHERE embedding IS NULL`);
  const noVectorProj = await db.execute(sql`
    SELECT count(*)::int AS n FROM chat_chunks WHERE embedding IS NULL`);
  log('\n── after ──');
  log(`placeholder project chunks remaining : ${(projLeft.rows[0] as { n: number }).n}`);
  log(`org documents with no chunks         : ${(orgEmpty.rows[0] as { n: number }).n}`);
  log(`org chunks with no vector            : ${(noVector.rows[0] as { n: number }).n}`);
  log(`project chunks with no vector        : ${(noVectorProj.rows[0] as { n: number }).n}`);
}

log(DRY ? '── DRY RUN ──' : '── applying ──');
await reindexProjectDocs();
await reindexOrgDocs();
await applyFixes();
await backfillMissingVectors();
await verify();
process.exit(0);
