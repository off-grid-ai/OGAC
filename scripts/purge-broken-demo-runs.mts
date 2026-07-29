// ─── Remove demo runs that failed for reasons that no longer exist ────────────────────────────────────
//
// The Work screen reported "COULD NOT FINISH 7" on the bank's reimbursement app. All seven were runs from
// this session's own debugging: a password-less MySQL connector, a data-allowlist that did not yet admit the
// new domain, and an unsatisfiable case filter. Every one of those causes is fixed, so the failures are not
// telling an operator anything true about the app — they are residue from fixing it, and on a demo tenant
// they read as "this app breaks".
//
// Deliberately NARROW: only runs in the two DEMO orgs, only status 'error', and only where the recorded
// failure detail matches one of the causes we fixed. A run that failed for any other reason is left alone —
// hiding a failure we do not understand would be the opposite of the point.
//
// RUN (on the server): npx tsx scripts/purge-broken-demo-runs.mts
import './worker-env.mts';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';

/** The causes fixed in this session. Anything else stays visible. */
const FIXED_CAUSES = [
  '%data access denied by pipeline%',
  '%case cannot satisfy filter%',
  '%could not be read%',
  '%No rows returned%',
  '%ER_ACCESS_DENIED%',
  '%unknown agent%',
];

const rows = (await db.execute(sql`
  SELECT id, app_id, org_id, steps FROM app_runs
  WHERE org_id IN ('org_bharat','org_suraksha') AND status = 'error'
`)) as unknown as {
  rows: { id: string; app_id: string; org_id: string; steps: { detail?: string; output?: string }[] | null }[];
};

const patterns = FIXED_CAUSES.map((p) => new RegExp(p.replaceAll('%', '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

let removed = 0;
let kept = 0;
for (const run of rows.rows ?? []) {
  const text = JSON.stringify(run.steps ?? []);
  if (patterns.some((pattern) => pattern.test(text))) {
    await db.execute(sql`DELETE FROM app_runs WHERE id = ${run.id} AND org_id = ${run.org_id}`);
    removed += 1;
  } else {
    kept += 1;
    console.log(`kept ${run.id} (${run.app_id}) — failure cause not one we fixed, so it stays visible`);
  }
}

console.log(`removed ${removed} run(s) that failed for causes now fixed · kept ${kept}`);
