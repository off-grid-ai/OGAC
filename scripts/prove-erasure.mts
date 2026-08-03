// THE DPO'S QUESTION, ANSWERED OR NOT: "a customer demands erasure — prove every copy is gone."
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { findChunksForSubject, eraseSubjectFromChunks } from '../src/lib/subject-index-store.ts';
import { describeMatches } from '../src/lib/subject-index.ts';

const ORG = 'org_bharat';
// Pick a REAL identifier that exists in this tenant's records, rather than one I invent.
const sample = await db.execute<{ t: string }>(sql`
  SELECT coalesce(input::text,'') t FROM app_runs
  WHERE org_id=${ORG} AND input::text ~ '[A-Z]{2,5}-[0-9]{2,4}-[0-9]+' LIMIT 1`);
const ref = /[A-Z]{2,5}-\d{2,4}-\d+/.exec(sample.rows[0]?.t ?? '')?.[0];
if (!ref) { console.log('no reference found to test with'); process.exit(1); }
console.log(`subject under test: ${ref}\n`);

const before = await findChunksForSubject(ORG, 'REFERENCE', ref);
console.log('BEFORE:', describeMatches('REFERENCE', before[0]?.masked ?? '?', before.length));
for (const m of before.slice(0, 5)) console.log(`   ${m.source.padEnd(8)} ${m.chunkId}`);

// Prove the data is genuinely present in the records right now.
const live = await db.execute<{ n: number }>(sql`
  SELECT count(*)::int n FROM app_runs WHERE org_id=${ORG}
    AND (input::text LIKE ${'%' + ref + '%'} OR steps::text LIKE ${'%' + ref + '%'})`);
console.log(`records physically containing it: ${live.rows[0].n}`);

const result = await eraseSubjectFromChunks(ORG, 'REFERENCE', ref);
console.log('\nERASURE:', JSON.stringify(result));

const after = await db.execute<{ n: number }>(sql`
  SELECT count(*)::int n FROM app_runs WHERE org_id=${ORG}
    AND (input::text LIKE ${'%' + ref + '%'} OR steps::text LIKE ${'%' + ref + '%'})`);
const stillIndexed = await findChunksForSubject(ORG, 'REFERENCE', ref);
console.log(`\nAFTER: records containing it: ${after.rows[0].n} · index rows: ${stillIndexed.length}`);
// The audit record must SURVIVE, redacted — not vanish.
const survives = await db.execute<{ n: number }>(sql`
  SELECT count(*)::int n FROM app_runs WHERE org_id=${ORG} AND steps::text LIKE '%[ERASED:REFERENCE]%'`);
console.log(`audit records preserved with an erasure marker: ${survives.rows[0].n}`);
// Does erasing THIS person leave everyone else findable? The first version of the index cleanup
// deleted every row for the matched chunks, which silently un-indexed other people in the same run —
// so their later erasure request would have reported "nothing to erase".
const others = await db.execute<{ n: number }>(sql`
  SELECT count(DISTINCT fingerprint)::int n FROM subject_chunk_index WHERE org_id=${ORG}`);
console.log(`other subjects still findable after this erasure: ${others.rows[0].n}`);

console.log(
  after.rows[0].n === 0 && stillIndexed.length === 0
    ? '\nPROVEN: no copy remains, and the decision record survives.'
    : '\nNOT PROVEN — copies remain.',
);

// SELF-RESTORING. This proof redacts real demo records; leaving them redacted would damage the demo
// to prove a point about protecting it. Put the subject back and re-index.
const restored = (await db.execute(sql`
  UPDATE app_runs SET
    input   = replace(input::text,  ${'[ERASED:REFERENCE]'}, ${ref})::jsonb,
    steps   = replace(steps::text,  ${'[ERASED:REFERENCE]'}, ${ref})::jsonb,
    outcome = replace(outcome,      ${'[ERASED:REFERENCE]'}, ${ref})
  WHERE org_id=${ORG}`)) as { rowCount?: number | null };
await db.execute(sql`
  UPDATE agent_runs SET citations = replace(citations::text, ${'[ERASED:REFERENCE]'}, ${ref})::jsonb
  WHERE org_id=${ORG} AND citations::text LIKE ${'%[ERASED:REFERENCE]%'}`);
console.log(`\nrestored ${restored.rowCount ?? 0} demo records (re-run the backfill to rebuild the index)`);
process.exit(0);
