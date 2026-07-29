// ─── Make the demo runs corroborate each other ───────────────────────────────────────────────────────
//
// The seeded corpus was correct but not believable, and the numbers on screen gave it away:
//
//  1. Runs that already HAD input in a different shape kept a machine-ish subject
//     ("Amount: 37,562 · Customer: Sanjay Rao"), because the earlier backfill only filled runs whose input
//     was empty. So a queue mixed real sentences with field dumps.
//  2. Every backfilled run shared one timestamp (2026-07-10 18:14 UTC), so "Recently handled" read as a
//     single batch rather than a process that runs over time — and the dashboard's 30-day window could not
//     show a trend because everything landed on one day.
//  3. Durations were days long, so "Usually takes" said 10 days for a reimbursement decision.
//
// This spreads runs across the window, gives each a realistic duration, and normalises any remaining
// field-dump subject into a sentence — using ONLY values already in that run's input. Nothing is invented:
// a run with no usable fields is left alone and reported.
//
// DETERMINISTIC (hash of the run id), so a re-run produces identical data and this is idempotent.
//
// RUN: npx tsx scripts/polish-demo-run-quality.mts
import './worker-env.mts';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';

/** Stable pseudo-random in [0,1) from a run id. */
function unit(id: string, salt = ''): number {
  let h = 2166136261;
  for (const ch of `${id}${salt}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 8) / 0x1000000;
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const NOW = Date.parse('2026-07-29T09:00:00Z');
const DAY = 86_400_000;

/** Field names worth naming a case after, in preference order. */
const WHO = ['customer_name', 'employee_name', 'applicant_name', 'policyholder_name', 'claimant_name', 'customer'];
const AMOUNT = ['claim_amount', 'loan_amount', 'transaction_amount', 'estimated_amount', 'overdue_amount', 'sum_assured', 'premium', 'amount'];

const rows = (await db.execute(sql`
  SELECT r.id, r.status, r.input, a.title
  FROM app_runs r JOIN apps a ON a.id = r.app_id
  WHERE r.org_id IN ('org_bharat','org_suraksha')
`)) as unknown as { rows: { id: string; status: string; input: Record<string, unknown> | null; title: string }[] };

let touched = 0;
let subjected = 0;
const unusable: string[] = [];

for (const row of rows.rows ?? []) {
  const input = (row.input ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = { ...input };

  // ── 1. A sentence subject, built only from fields this run already carries. ──
  if (typeof patch.subject !== 'string' || !patch.subject.trim()) {
    const who = WHO.map((k) => patch[k]).find((v) => typeof v === 'string' && v.trim());
    const amountKey = AMOUNT.find((k) => Number.isFinite(Number(patch[k])));
    const amount = amountKey ? Number(patch[amountKey]) : null;
    // The process name comes from the app itself, so the sentence is about the real workflow.
    const process = row.title.replace(/\s*\(copy\)\s*$/i, '').trim();
    if (who && amount !== null) patch.subject = `${process} — ${who}, ${inr(amount)}`;
    else if (who) patch.subject = `${process} — ${who}`;
    else {
      unusable.push(`${row.id} (${process}) — no name or amount to build a subject from`);
    }
    if (typeof patch.subject === 'string') subjected += 1;
  }

  // ── 2. Spread across the last 30 days, and 3. a realistic duration. ──
  // Waiting cases skew RECENT (a queue of six-week-old decisions would be its own story), finished ones
  // spread across the whole window so the dashboard shows a process running over time.
  const waiting = row.status === 'awaiting_human';
  const daysAgo = waiting ? unit(row.id, 'w') * 6 : unit(row.id, 'd') * 29 + 0.5;
  const startedAt = new Date(NOW - daysAgo * DAY);

  // 3 to 25 minutes: a governed run that reads data, calls a model and writes a report. Days was absurd.
  const durationMs = Math.round((3 + unit(row.id, 'x') * 22) * 60_000);
  const finishedAt =
    row.status === 'done' || row.status === 'error' || row.status === 'cancelled'
      ? new Date(startedAt.getTime() + durationMs)
      : null;

  await db.execute(sql`
    UPDATE app_runs
    SET input = ${JSON.stringify(patch)}::jsonb,
        started_at = ${startedAt.toISOString()},
        finished_at = ${finishedAt ? finishedAt.toISOString() : null}
    WHERE id = ${row.id}
  `);
  touched += 1;
}

console.log(`polished ${touched} runs · ${subjected} gained a sentence subject`);
if (unusable.length) {
  console.log(`left without a subject (${unusable.length}) — nothing invented:`);
  for (const u of unusable.slice(0, 8)) console.log(`  - ${u}`);
}
