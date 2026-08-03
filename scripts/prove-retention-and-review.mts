// ─── Prove the two write paths I built but never ran ───────────────────────────────────────────────
//
// The retention sweep and the access review were deployed and rendered, but neither had ever been
// EXECUTED. A surface that renders is WIRED, not verified — and both of these destroy or revoke
// things, which is exactly the class of code that must not be trusted on a typecheck.
//
// So this drives both through their real seams, on a SCRATCH ORG with rows it creates itself, and
// cleans up after. Demo tenant data is never touched: a proof that damages the thing it is proving
// on is not a proof (learned the hard way — an earlier erasure proof redacted 11 real demo runs).
//
//   /usr/local/bin/node --env-file=.env.local ./node_modules/.bin/tsx scripts/prove-retention-and-review.mts

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { recordAccessReview, listAccessReviews } from '../src/lib/access-reviews-store.ts';
import { validateReview } from '../src/lib/access-review.ts';
import { listRetentionRuns, runRetentionSweep, upsertRetentionRule } from '../src/lib/retention-store.ts';

const ORG = `org_proof_${randomUUID().slice(0, 6)}`;
const fails: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(label);
};

console.log(`scratch org: ${ORG}\n── RETENTION ──`);

// Two app_runs: one well past any cutoff, one brand new. Retention must take the old one and leave
// the new one — a sweep that takes everything looks identical to a sweep that works.
const oldId = `run_old_${randomUUID().slice(0, 8)}`;
const newId = `run_new_${randomUUID().slice(0, 8)}`;
await db.execute(sql`
  INSERT INTO app_runs (id, org_id, app_id, status, input, steps, outcome, started_at)
  VALUES (${oldId}, ${ORG}, 'app_proof', 'done', '{"pan":"ABCDE1234F"}'::jsonb,
          '[{"id":"s1","kind":"llm","label":"x","status":"done","outcome":"Ravi Kumar, PAN ABCDE1234F"}]'::jsonb,
          'Ravi Kumar approved', now() - interval '400 days'),
         (${newId}, ${ORG}, 'app_proof', 'done', '{"pan":"ZYXWV9876Z"}'::jsonb,
          '[{"id":"s1","kind":"llm","label":"x","status":"done","outcome":"recent"}]'::jsonb,
          'recent run', now());`);

// 30-day limit, redact — the setting that keeps the decision trail and removes the content.
await upsertRetentionRule(
  { recordClass: 'app_runs', retainDays: 30, action: 'redact' },
  'proof-script',
  ORG,
);
const sweep = await runRetentionSweep('proof-script', ORG);
const appOutcome = sweep.outcomes.find((o) => o.recordClass === 'app_runs');

check('sweep recorded an outcome for app runs', Boolean(appOutcome), JSON.stringify(appOutcome));
check('exactly one run was past the limit', appOutcome?.affected === 1, `affected=${appOutcome?.affected}`);
check('re-count after the work found nothing left', appOutcome?.remaining === 0, `remaining=${appOutcome?.remaining}`);
check('the sweep reports itself complete', sweep.complete === true, sweep.summary);

// The terminal artefact: what is actually in the rows now.
const rows = await db.execute<{ id: string; outcome: string; input: string; steps: string }>(sql`
  SELECT id, outcome, input::text, steps::text FROM app_runs WHERE org_id = ${ORG} ORDER BY started_at`);
const oldRow = rows.rows.find((r) => r.id === oldId);
const newRow = rows.rows.find((r) => r.id === newId);
check('the old run still EXISTS (redact keeps the audit trail)', Boolean(oldRow));
check('the old run no longer carries the personal data', !/Ravi Kumar|ABCDE1234F/.test(
  `${oldRow?.outcome} ${oldRow?.input} ${oldRow?.steps}`,
), oldRow?.outcome);
check('the recent run was NOT touched', /recent run/.test(newRow?.outcome ?? '') && /ZYXWV9876Z/.test(newRow?.input ?? ''));

// The classes with no rule must be reported as gaps, not silently omitted.
check(
  'classes with no rule are reported as gaps',
  sweep.skipped.some((s) => s.recordClass === 'agent_runs') &&
    sweep.skipped.some((s) => s.recordClass === 'knowledge_chunks'),
  sweep.skipped.map((s) => s.recordClass).join(','),
);

// Legal hold must suspend deletion — and say why.
await upsertRetentionRule(
  { recordClass: 'app_runs', retainDays: 30, action: 'delete', legalHold: true },
  'proof-script',
  ORG,
);
const held = await runRetentionSweep('proof-script', ORG);
check('legal hold stops the sweep touching the class', !held.outcomes.some((o) => o.recordClass === 'app_runs'));
check(
  'legal hold is named as the reason',
  held.skipped.some((s) => s.recordClass === 'app_runs' && /legal hold/i.test(s.reason)),
  held.skipped.find((s) => s.recordClass === 'app_runs')?.reason,
);

const persisted = await listRetentionRuns(ORG);
check('both sweeps are durably on record', persisted.length === 2, `${persisted.length} records`);

console.log('\n── ACCESS REVIEW ──');

const subjects = [
  { id: 'u_keep', email: 'keep@proof.test', role: 'viewer' },
  { id: 'u_drop', email: 'drop@proof.test', role: 'admin' },
];

// An incomplete review must be REFUSED — a partial review certifies nothing.
check(
  'a review missing a decision is refused',
  !validateReview(subjects, [{ userId: 'u_keep', email: 'keep@proof.test', decision: 'keep' }]).ok,
);
// A revocation with no reason must be refused.
check(
  'a revocation with no reason is refused',
  !validateReview(subjects, [
    { userId: 'u_keep', email: 'keep@proof.test', decision: 'keep' },
    { userId: 'u_drop', email: 'drop@proof.test', decision: 'revoke' },
  ]).ok,
);
const complete = validateReview(subjects, [
  { userId: 'u_keep', email: 'keep@proof.test', decision: 'keep' },
  { userId: 'u_drop', email: 'drop@proof.test', decision: 'revoke', reason: 'left the company' },
]);
check('a complete, reasoned review is accepted', complete.ok, complete.errors.join('; '));

// A failure to apply must be recorded as a failure, not smoothed into the summary.
const rec = await recordAccessReview(
  {
    reviewedBy: 'proof-script',
    decisions: [
      { userId: 'u_keep', email: 'keep@proof.test', decision: 'keep' },
      { userId: 'u_drop', email: 'drop@proof.test', decision: 'revoke', reason: 'left the company' },
    ],
    applied: [
      { email: 'keep@proof.test', action: 'access confirmed', ok: true },
      { email: 'drop@proof.test', action: 'access removed', ok: false, detail: 'user already gone' },
    ],
  },
  ORG,
);
check('the artefact is durable and summarised', /2 people reviewed/.test(rec.summary), rec.summary);
check('the summary names the removal', /1 removed/.test(rec.summary), rec.summary);
const readBack = await listAccessReviews(ORG);
check('it reads back with the failure preserved', readBack[0]?.applied.some((a) => !a.ok), JSON.stringify(readBack[0]?.applied));
check('the reviewer is named', readBack[0]?.reviewedBy === 'proof-script');

// ── CLEAN UP. The scratch org leaves nothing behind. ──
await db.execute(sql`DELETE FROM app_runs WHERE org_id = ${ORG}`);
await db.execute(sql`DELETE FROM record_retention WHERE org_id = ${ORG}`);
await db.execute(sql`DELETE FROM retention_runs WHERE org_id = ${ORG}`);
await db.execute(sql`DELETE FROM access_reviews WHERE org_id = ${ORG}`);
const leftover = await db.execute<{ n: number }>(sql`
  SELECT (SELECT count(*) FROM app_runs WHERE org_id = ${ORG})
       + (SELECT count(*) FROM retention_runs WHERE org_id = ${ORG})
       + (SELECT count(*) FROM access_reviews WHERE org_id = ${ORG})
       + (SELECT count(*) FROM record_retention WHERE org_id = ${ORG}) AS n`);
check('the scratch org left nothing behind', Number(leftover.rows[0]?.n) === 0, `${leftover.rows[0]?.n} rows`);

console.log(`\n${fails.length ? `FAILED (${fails.length}): ${fails.join(' | ')}` : 'ALL CHECKS PASSED'}`);
process.exit(fails.length ? 1 : 0);
