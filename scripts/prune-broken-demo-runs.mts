import './worker-env.mts';
import { Client } from 'pg';

// Remove the demo runs that are not runs — the `ar_*` seed family was INSERTed with every step
// outcome blank, so each one renders as a case that produced nothing: "no final outcome recorded" on
// its report, an empty recommendation in the review queue, and a Reports row with no decision. They
// are also what made the deployed app claim no AI calls had been recorded. Plus the specific junk:
// repeated test triggers on one case, and two `error` rows whose failure detail is empty so a reader
// learns nothing from the red row.
//
// DRY RUN unless --apply is passed. Never deletes a run that carries real model output.
const APPLY = process.argv.includes('--apply');
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const APPS = [
  'app_14940314',
  'app_c38d2c5e',
  'app_96fe960f',
  'bhapp_kyc',
  'bhapp_loan',
  'bhapp_reimb',
];

// 1. The empty seed family: no agent step ever produced text AND no aggregate outcome.
const empties = await c.query(
  `select id, app_id, status from app_runs
     where app_id = any($1)
       and coalesce(outcome,'') = ''
       and not exists (select 1 from jsonb_array_elements(steps) s
                        where s->>'kind'='agent' and coalesce(s->>'outcome','') <> '')
     order by app_id, started_at`,
  [APPS],
);

// 2. An `error` run whose every failed step has an EMPTY detail — a red row that explains nothing.
const mute = await c.query(
  `select id, app_id, status from app_runs
     where app_id = any($1) and status = 'error'
       and not exists (select 1 from jsonb_array_elements(steps) s
                        where s->>'status'='error' and coalesce(s->>'detail','') <> '')
     order by app_id`,
  [APPS],
);

// 3. Duplicate waiting cases: the same case fired repeatedly while testing. Keep the NEWEST of each
//    (case identity = the case record's own key fields), drop the rest.
const dupes = await c.query(
  `with waiting as (
     select id, app_id, started_at,
            coalesce(input->'body'->'case'->>'claim_no', input->'body'->'case'->>'id',
                     input->>'subject') as case_key
       from app_runs
      where app_id = any($1) and status = 'awaiting_human'
   ), ranked as (
     select id, app_id, case_key,
            row_number() over (partition by app_id, case_key order by started_at desc) as rn
       from waiting where case_key is not null
   )
   select id, app_id, case_key from ranked where rn > 1 order by app_id`,
  [APPS],
);

// 4. A run whose FIRST data step could not bind its case at all — fired with no case record, so it
//    never had anything to work on. Honest failure, but not demo material.
const unbound = await c.query(
  `select id, app_id from app_runs
     where app_id = any($1) and status = 'error'
       and exists (select 1 from jsonb_array_elements(steps) s
                    where s->>'status'='error' and s->>'detail' like '%cannot satisfy filter%')`,
  [APPS],
);

// 5. My own pre-fix verification runs: the agent step answered with the "Based on N source(s)" echo,
//    which is the fabricated output the code fix removed. Superseded, so they must not survive.
const echoes = await c.query(
  `select id, app_id from app_runs
     where app_id = any($1)
       and exists (select 1 from jsonb_array_elements(steps) s
                    where s->>'kind'='agent' and s->>'outcome' like 'Based on % source(s):%')`,
  [APPS],
);

const groups: [string, { id: string; app_id: string }[]][] = [
  ['empty seed family (no model output at all)', empties.rows],
  ['error with no failure detail', mute.rows],
  ['duplicate waiting case', dupes.rows],
  ['error: case never bound', unbound.rows],
  ['pre-fix run carrying the fabricated source echo', echoes.rows],
];

const doomed = new Map<string, string>();
for (const [why, rows] of groups) {
  console.log(`\n--- ${why}: ${rows.length}`);
  for (const r of rows) {
    console.log(`    ${r.app_id.padEnd(14)} ${r.id}`);
    if (!doomed.has(r.id)) doomed.set(r.id, `${r.app_id}|${why}`);
  }
}

// SAFETY: never leave an app with NOTHING to show. An app whose whole history is broken is a real
// finding to report, not a reason to blank its Runs tab — an empty app reads worse to a stranger than
// a poor one, and it would also hide the defect. So an app that cannot survive the cleanup is SKIPPED
// entirely and named, and its runs stay until real ones exist to replace them.
console.log('\n=== survivors per app ===');
const skipped: string[] = [];
for (const app of APPS) {
  const all = await c.query(`select id, status from app_runs where app_id=$1`, [app]);
  const left = all.rows.filter((r) => !doomed.has(r.id));
  if (left.length === 0) {
    skipped.push(app);
    for (const r of all.rows) doomed.delete(r.id);
    console.log(`${app.padEnd(14)} SKIPPED — every run would go; left intact pending real runs`);
    continue;
  }
  const waiting = left.filter((r) => r.status === 'awaiting_human').length;
  const done = left.filter((r) => r.status === 'done').length;
  console.log(
    `${app.padEnd(14)} ${String(left.length).padStart(3)} left (${done} done, ${waiting} waiting)`,
  );
}

if (!APPLY) {
  console.log(`\nDRY RUN — ${doomed.size} run(s) would be deleted. Pass --apply to execute.`);
  if (skipped.length) console.log(`SKIPPED apps (still broken, report them): ${skipped.join(', ')}`);
  await c.end();
  process.exit(0);
}
const ids = [...doomed.keys()];
const res = await c.query(`delete from app_runs where id = any($1)`, [ids]);
console.log(`\nDELETED ${res.rowCount} run(s).`);
await c.end();
