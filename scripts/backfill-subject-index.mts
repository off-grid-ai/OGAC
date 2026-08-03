// ─── Index the corpus that already exists ──────────────────────────────────────────────────────────
//
// New documents are indexed as they are written. Everything already embedded — the whole demo corpus,
// and on a real deployment everything ingested before this shipped — is invisible to erasure until it
// is walked once. An erasure feature that only covers documents added after install is not one.
//
//   /usr/local/bin/node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-subject-index.mts [--apply]

import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { extractSubjects } from '../src/lib/subject-index.ts';
import { indexChunkSubjects, subjectIndexCoverage } from '../src/lib/subject-index-store.ts';

const APPLY = process.argv.includes('--apply');

// Org-collection chunks, with the org resolved through their collection.
const orgChunks = await db.execute<{
  id: string;
  doc_id: string;
  collection_id: string;
  org_id: string;
  content: string;
}>(sql`
  SELECT c.id, c.doc_id, c.collection_id, k.org_id, c.content
  FROM org_knowledge_chunks c
  JOIN org_knowledge_docs d ON d.id = c.doc_id
  JOIN org_knowledge_collections k ON k.id = d.collection_id`);

// Project chunks, with the org resolved through their project.
const projectChunks = await db.execute<{
  id: string;
  doc_id: string;
  project_id: string;
  org_id: string;
  content: string;
}>(sql`
  SELECT c.id, c.doc_id, c.project_id, p.org_id, c.content
  FROM chat_chunks c JOIN chat_projects p ON p.id = c.project_id`);

// RUN EVIDENCE — where the personal data actually is. Measured before writing this: 27 knowledge
// chunks held 0 identifiers while 149 runs held 134. Indexing only the corpus would have produced an
// erasure feature that finds nothing and says so confidently.
const runs = await db.execute<{ id: string; org_id: string; t: string }>(sql`
  SELECT r.id, r.org_id,
         coalesce(r.input::text,'') || ' ' || coalesce(r.steps::text,'') || ' ' || coalesce(r.outcome,'') t
  FROM app_runs r`);

console.log(`org chunks: ${orgChunks.rows.length} · project chunks: ${projectChunks.rows.length} · runs: ${runs.rows.length}`);

// What WOULD be found, before writing anything — so a dry run is a real preview.
let hits = 0;
const byType = new Map<string, number>();
for (const c of [...orgChunks.rows, ...projectChunks.rows, ...runs.rows.map((r) => ({ content: r.t }))]) {
  for (const h of extractSubjects(c.content)) {
    hits++;
    byType.set(h.type, (byType.get(h.type) ?? 0) + 1);
  }
}
console.log(`\nidentifiers found: ${hits}`);
for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${t.padEnd(12)} ${n}`);

if (APPLY) {
  // Grouped per (org, source) so each call writes one org's rows — the index is org-scoped and a
  // cross-org write would be a tenancy bug in the very table meant to prove tenancy.
  const groups = new Map<string, { org: string; source: 'org' | 'project' | 'run'; rows: { chunkId: string; docId: string; containerId: string; content: string }[] }>();
  for (const c of orgChunks.rows) {
    const key = `org:${c.org_id}`;
    groups.set(key, groups.get(key) ?? { org: c.org_id, source: 'org', rows: [] });
    groups.get(key)!.rows.push({ chunkId: c.id, docId: c.doc_id, containerId: c.collection_id, content: c.content });
  }
  for (const c of projectChunks.rows) {
    const key = `project:${c.org_id}`;
    groups.set(key, groups.get(key) ?? { org: c.org_id, source: 'project', rows: [] });
    groups.get(key)!.rows.push({ chunkId: c.id, docId: c.doc_id, containerId: c.project_id, content: c.content });
  }
  for (const r of runs.rows) {
    const key = `run:${r.org_id}`;
    groups.set(key, groups.get(key) ?? { org: r.org_id, source: 'run', rows: [] });
    // For a run the "chunk" IS the run: chunkId and containerId are both the run id, so erasure can
    // redact the record in place rather than deleting an audit trail.
    groups.get(key)!.rows.push({ chunkId: r.id, docId: r.id, containerId: r.id, content: r.t });
  }
  // Re-runnable: clear what we are about to rewrite rather than duplicating it.
  await db.execute(sql`DELETE FROM subject_chunk_index`);
  for (const g of groups.values()) {
    const n = await indexChunkSubjects(g.org, g.source, g.rows);
    console.log(`indexed ${n} identifier(s) across ${g.rows.length} ${g.source} chunks for ${g.org}`);
  }
}

for (const org of ['org_bharat', 'org_suraksha']) {
  const cov = await subjectIndexCoverage(org);
  console.log(
    `\n${org}: ${cov.subjects} distinct subjects across ${cov.indexedChunks} chunks — ${cov.byType.map((t) => `${t.type} ${t.n}`).join(', ') || 'none'}`,
  );
}
process.exit(0);
