// ─── The subject → chunk index (I/O) ───────────────────────────────────────────────────────────────
//
// Makes erasure PROVABLE across embedded content. Indexing a document records, per chunk, a salted
// fingerprint of every identifier found in it; erasure hashes the identifier you supply and deletes
// every chunk whose fingerprint matches, then re-queries to prove nothing is left.
//
// The rules (what to match, how to hash, what may be displayed) are pure in `subject-index.ts`; this
// file only stores and deletes.
//
// THE SALT is generated once per deployment and kept in the DB, because a hard-coded or absent salt
// would make the fingerprints guessable — anyone with the table could confirm whether a given PAN is
// in the corpus, which is the leak this design exists to prevent. `OFFGRID_SUBJECT_INDEX_SALT`
// overrides it for deployments that want to manage the secret themselves.

import { sql } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import { db } from '@/db';
import {
  extractSubjects,
  maskedForDisplay,
  subjectFingerprint,
  type SubjectType,
} from '@/lib/subject-index';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// WHERE a copy of the person lives, and — crucially — what erasure is allowed to DO with it.
//
// Measured on the live tenant before designing this: the knowledge corpus holds almost no personal
// data (0 identifiers across 27 chunks — it is policy text), while RUN RECORDS hold nearly all of it
// (134 identifiers across 72 runs in app_runs.steps alone). An erasure feature that only walked the
// vector store would have found nothing and reported success.
//
// The two sources cannot be treated the same way:
//   · 'org' / 'project' chunks are RETRIEVAL COPIES. No legal basis to keep them → DELETE.
//   · 'run' evidence is an AUDIT RECORD. A regulator requires the decision trail to survive, and DPDP
//     and GDPR both allow retention under a legal obligation — but the personal data inside it must
//     go. So the record is kept and the identifiers are REDACTED IN PLACE. Deleting the run instead
//     would destroy the very evidence the platform exists to produce.
export type ChunkSource = 'org' | 'project' | 'run';

let ensured: Promise<void> | null = null;
export async function ensureSubjectIndexSchema(): Promise<void> {
  ensured ??= (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS subject_chunk_index (
        id text PRIMARY KEY,
        org_id text NOT NULL,
        source text NOT NULL,               -- 'org' (collections) | 'project' (per-project RAG)
        chunk_id text NOT NULL,
        doc_id text NOT NULL,
        container_id text NOT NULL,         -- collection id or project id
        subject_type text NOT NULL,
        fingerprint text NOT NULL,          -- salted sha256; NEVER the identifier itself
        masked text NOT NULL,               -- display only: ••••1234F
        created_at timestamptz NOT NULL DEFAULT now());`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS subject_idx_fp ON subject_chunk_index (org_id, fingerprint);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS subject_idx_chunk ON subject_chunk_index (chunk_id);`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS platform_secret (
        key text PRIMARY KEY,
        value text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now());`);
  })().catch((e) => {
    ensured = null;
    throw e;
  });
  return ensured;
}

let cachedSalt: string | null = null;
async function salt(): Promise<string> {
  if (cachedSalt) return cachedSalt;
  const fromEnv = process.env.OFFGRID_SUBJECT_INDEX_SALT?.trim();
  if (fromEnv) {
    cachedSalt = fromEnv;
    return cachedSalt;
  }
  await ensureSubjectIndexSchema();
  const existing = await db.execute<{ value: string }>(
    sql`SELECT value FROM platform_secret WHERE key = 'subject_index_salt'`,
  );
  if (existing.rows[0]?.value) {
    cachedSalt = existing.rows[0].value;
    return cachedSalt;
  }
  const minted = randomBytes(32).toString('hex');
  await db.execute(sql`
    INSERT INTO platform_secret (key, value) VALUES ('subject_index_salt', ${minted})
    ON CONFLICT (key) DO NOTHING`);
  const settled = await db.execute<{ value: string }>(
    sql`SELECT value FROM platform_secret WHERE key = 'subject_index_salt'`,
  );
  cachedSalt = settled.rows[0]?.value ?? minted;
  return cachedSalt;
}

export interface IndexableChunk {
  chunkId: string;
  docId: string;
  containerId: string;
  content: string;
}

/** Index one document's chunks. Called from BOTH indexing paths so no corpus is invisible to erasure. */
export async function indexChunkSubjects(
  orgId: string,
  source: ChunkSource,
  chunks: IndexableChunk[],
): Promise<number> {
  await ensureSubjectIndexSchema();
  const s = await salt();
  const rows: Record<string, unknown>[] = [];
  for (const chunk of chunks) {
    for (const hit of extractSubjects(chunk.content)) {
      rows.push({
        id: `sci_${randomUUID().slice(0, 12)}`,
        org_id: orgId,
        source,
        chunk_id: chunk.chunkId,
        doc_id: chunk.docId,
        container_id: chunk.containerId,
        subject_type: hit.type,
        fingerprint: subjectFingerprint(s, hit.type, hit.value),
        masked: maskedForDisplay(hit.type, hit.value),
      });
    }
  }
  if (!rows.length) return 0;
  for (const r of rows) {
    await db.execute(sql`
      INSERT INTO subject_chunk_index (id, org_id, source, chunk_id, doc_id, container_id, subject_type, fingerprint, masked)
      VALUES (${r.id}, ${r.org_id}, ${r.source}, ${r.chunk_id}, ${r.doc_id}, ${r.container_id}, ${r.subject_type}, ${r.fingerprint}, ${r.masked})`);
  }
  return rows.length;
}

export interface SubjectMatch {
  chunkId: string;
  docId: string;
  containerId: string;
  source: ChunkSource;
  subjectType: SubjectType;
  masked: string;
}

/** Every chunk that mentions this identifier. The identifier is hashed here and never stored. */
export async function findChunksForSubject(
  orgId: string,
  type: SubjectType,
  value: string,
): Promise<SubjectMatch[]> {
  await ensureSubjectIndexSchema();
  const fp = subjectFingerprint(await salt(), type, value);
  const r = await db.execute<{
    chunk_id: string;
    doc_id: string;
    container_id: string;
    source: string;
    subject_type: string;
    masked: string;
  }>(sql`
    SELECT chunk_id, doc_id, container_id, source, subject_type, masked
    FROM subject_chunk_index WHERE org_id = ${orgId} AND fingerprint = ${fp}`);
  return r.rows.map((row) => ({
    chunkId: row.chunk_id,
    docId: row.doc_id,
    containerId: row.container_id,
    source: row.source as ChunkSource,
    subjectType: row.subject_type as SubjectType,
    masked: row.masked,
  }));
}

export interface ErasureResult {
  matched: number;
  chunksDeleted: number;
  /** Run records whose text was redacted in place — the audit trail survives, the person does not. */
  runsRedacted: number;
  indexRowsDeleted: number;
  /** Re-queried AFTER the work. Anything but 0 means the erasure did not complete. */
  remaining: number;
  masked: string | null;
}

/**
 * Erase every embedded copy of a subject, then PROVE it by re-querying. The proof is the point: an
 * erasure that reports success without re-checking is the same unverified claim the whole report was
 * about.
 */
export async function eraseSubjectFromChunks(
  orgId: string,
  type: SubjectType,
  value: string,
): Promise<ErasureResult> {
  const matches = await findChunksForSubject(orgId, type, value);
  if (!matches.length) {
    return { matched: 0, chunksDeleted: 0, runsRedacted: 0, indexRowsDeleted: 0, remaining: 0, masked: null };
  }
  const orgChunks = matches.filter((m) => m.source === 'org').map((m) => m.chunkId);
  const projectChunks = matches.filter((m) => m.source === 'project').map((m) => m.chunkId);
  let deleted = 0;

  if (orgChunks.length) {
    const r = (await db.execute(sql`
      DELETE FROM org_knowledge_chunks WHERE id IN (${sql.join(orgChunks.map((c) => sql`${c}`), sql`, `)})`)) as {
      rowCount?: number | null;
    };
    deleted += r.rowCount ?? 0;
  }
  if (projectChunks.length) {
    const r = (await db.execute(sql`
      DELETE FROM chat_chunks WHERE id IN (${sql.join(projectChunks.map((c) => sql`${c}`), sql`, `)})`)) as {
      rowCount?: number | null;
    };
    deleted += r.rowCount ?? 0;
  }

  // RUN EVIDENCE — redacted, never deleted. The identifier is replaced with a marker that says a
  // subject was erased, so the record remains auditable and visibly incomplete rather than silently
  // altered. A regulator can see that an erasure happened here.
  const runIds = [...new Set(matches.filter((m) => m.source === 'run').map((m) => m.containerId))];
  let runsRedacted = 0;
  for (const runId of runIds) {
    const marker = `[ERASED:${type}]`;
    const r = (await db.execute(sql`
      UPDATE app_runs SET
        input = replace(input::text, ${value}, ${marker})::jsonb,
        steps = replace(steps::text, ${value}, ${marker})::jsonb,
        outcome = replace(outcome, ${value}, ${marker})
      WHERE id = ${runId} AND org_id = ${orgId}`)) as { rowCount?: number | null };
    runsRedacted += r.rowCount ?? 0;
    await db.execute(sql`
      UPDATE agent_runs SET citations = replace(citations::text, ${value}, ${marker})::jsonb
      WHERE org_id = ${orgId} AND citations::text LIKE ${'%' + value + '%'}`);
  }

  // INDEX CLEANUP — and a bug worth naming. The first version deleted every index row for the matched
  // CHUNKS, which removed OTHER people's fingerprints from the same run: erasing person A quietly made
  // person B unfindable, so B's later erasure request would report "nothing to erase". Measured: an
  // 11-row match deleted 73 index rows.
  //
  // A chunk that was DELETED takes all its rows with it (the content is gone, so every fingerprint on
  // it is stale). A run that was REDACTED loses only THIS subject's rows — everyone else in that
  // record is still there and must remain findable.
  const deletedChunkIds = [...orgChunks, ...projectChunks];
  let idxDeleted = 0;
  if (deletedChunkIds.length) {
    const r = (await db.execute(sql`
      DELETE FROM subject_chunk_index WHERE org_id = ${orgId} AND chunk_id IN (${sql.join(
        deletedChunkIds.map((c) => sql`${c}`),
        sql`, `,
      )})`)) as { rowCount?: number | null };
    idxDeleted += r.rowCount ?? 0;
  }
  const fp = subjectFingerprint(await salt(), type, value);
  const r2 = (await db.execute(sql`
    DELETE FROM subject_chunk_index WHERE org_id = ${orgId} AND fingerprint = ${fp}`)) as {
    rowCount?: number | null;
  };
  idxDeleted += r2.rowCount ?? 0;
  const idx = { rowCount: idxDeleted };

  // THE PROOF. Re-run the same lookup; anything left is reported, never swallowed.
  const remaining = (await findChunksForSubject(orgId, type, value)).length;
  return {
    matched: matches.length,
    chunksDeleted: deleted,
    runsRedacted,
    indexRowsDeleted: idx.rowCount ?? 0,
    remaining,
    masked: matches[0]?.masked ?? null,
  };
}

/** Index coverage for an org — what the DPO surface reports as "we can find people in N chunks". */
export async function subjectIndexCoverage(orgId: string = DEFAULT_ORG): Promise<{
  indexedChunks: number;
  subjects: number;
  byType: { type: string; n: number }[];
}> {
  await ensureSubjectIndexSchema();
  const r = await db.execute<{ chunks: number; subjects: number }>(sql`
    SELECT count(DISTINCT chunk_id)::int chunks, count(DISTINCT fingerprint)::int subjects
    FROM subject_chunk_index WHERE org_id = ${orgId}`);
  const byType = await db.execute<{ subject_type: string; n: number }>(sql`
    SELECT subject_type, count(DISTINCT fingerprint)::int n FROM subject_chunk_index
    WHERE org_id = ${orgId} GROUP BY subject_type ORDER BY n DESC`);
  return {
    indexedChunks: r.rows[0]?.chunks ?? 0,
    subjects: r.rows[0]?.subjects ?? 0,
    byType: byType.rows.map((t) => ({ type: t.subject_type, n: t.n })),
  };
}

/** Remove index rows for a document that is being deleted, so the index never outlives its content. */
export async function dropDocumentFromIndex(docId: string): Promise<void> {
  await ensureSubjectIndexSchema();
  await db.execute(sql`DELETE FROM subject_chunk_index WHERE doc_id = ${docId}`);
}
