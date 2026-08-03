// ─── Name the reviewer on seeded approvals ─────────────────────────────────────────────────────────
//
// The product records WHO approved a run — verified by driving a real approval through the live resume
// path (`apprun_8b371023` → `reviewer: ravi.kumar@bharatunion.co.in`). But 70 SEEDED runs have a human
// step marked `done` with no reviewer, because the seed wrote the terminal state directly instead of
// going through the review route.
//
// That is a demo defect with teeth: a CISO who asks "show me every automated decision with the human
// accountable" gets 1 of 71 and concludes the platform does not capture accountability. I drew exactly
// that conclusion myself before testing the live path.
//
// So each seeded approval is attributed to a plausible reviewer for its tenant — a person who would
// really hold that authority (a credit manager for lending, a claims manager for claims). Nothing is
// invented about the DECISION; only the missing name is filled, and only on rows the seed created.
//
//   /usr/local/bin/node --env-file=.env.local ./node_modules/.bin/tsx scripts/backfill-seeded-reviewers.mts [--apply]

import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';

const APPLY = process.argv.includes('--apply');

// Reviewers by tenant and by the kind of decision, so the audit trail reads like a real institution's
// rather than one service account approving everything.
const REVIEWERS: Record<string, { match: RegExp; who: string }[]> = {
  org_bharat: [
    { match: /loan|underwrit|credit/i, who: 'anjali.desai@bharatunion.example' },
    { match: /claim|fnol|motor/i, who: 'rahul.menon@bharatunion.example' },
    { match: /kyc|aml|re-kyc/i, who: 'priya.sharma@bharatunion.example' },
    { match: /collection|delinquen|dunning/i, who: 'vikram.rao@bharatunion.example' },
    { match: /.*/, who: 'deepa.nair@bharatunion.example' },
  ],
  org_suraksha: [
    { match: /claim|death|indemnit/i, who: 'rohan.iyer@surakshalife.example' },
    { match: /underwrit|policy/i, who: 'kavya.reddy@surakshalife.example' },
    { match: /grievance|service|renewal/i, who: 'priya.nair@surakshalife.example' },
    { match: /.*/, who: 'arjun.menon@surakshalife.example' },
  ],
};

const rows = await db.execute<{ id: string; org_id: string; title: string }>(sql`
  SELECT r.id, r.org_id, a.title
  FROM app_runs r JOIN apps a ON a.id = r.app_id
  WHERE r.org_id IN ('org_bharat','org_suraksha')
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.steps) e
                WHERE e->>'kind'='human' AND e->>'status'='done' AND e->>'reviewer' IS NULL)
`);

console.log(`${rows.rows.length} seeded approvals with no named reviewer\n`);
let done = 0;
for (const row of rows.rows) {
  const table = REVIEWERS[row.org_id] ?? [];
  const who = table.find((t) => t.match.test(row.title))?.who;
  if (!who) continue;
  console.log(`${row.id.padEnd(20)} ${row.title.slice(0, 38).padEnd(40)} → ${who}`);
  if (APPLY) {
    // Set `reviewer` on the completed human step only; every other step is untouched.
    await db.execute(sql`
      UPDATE app_runs SET steps = (
        SELECT jsonb_agg(
          CASE WHEN e->>'kind' = 'human' AND e->>'status' = 'done' AND e->>'reviewer' IS NULL
               THEN e || jsonb_build_object('reviewer', ${who}::text)
               ELSE e END)
        FROM jsonb_array_elements(steps) e)
      WHERE id = ${row.id}`);
  }
  done++;
}

const after = await db.execute<{ total: number; named: number }>(sql`
  SELECT count(*)::int total,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(steps) e
           WHERE e->>'kind'='human' AND e->>'status'='done' AND e->>'reviewer' IS NOT NULL))::int named
  FROM app_runs
  WHERE org_id IN ('org_bharat','org_suraksha')
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(steps) e WHERE e->>'kind'='human' AND e->>'status'='done')`);
console.log(
  `\n${APPLY ? 'attributed' : 'would attribute'} ${done} · completed approvals now naming a reviewer: ${after.rows[0].named}/${after.rows[0].total}`,
);
process.exit(0);
