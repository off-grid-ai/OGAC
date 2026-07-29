// ─── Make each demo app's trigger match how its work really arrives ─────────────────────────────────
//
// WHY. Every seeded app was `on-demand`, so the console honestly reported "Somebody starts each case here"
// and offered a box to type the case into. That is backwards for these processes and contradicts the model
// in docs/APP_AS_PRODUCT.md §3: an app automates a process that ALREADY runs, so its data already flows in
// — an invoice arrives by email, a grievance on WhatsApp, a claim intimation on WhatsApp. The clerk's job
// is to decide, not to transcribe a description of work that should have arrived.
//
// The screens already adapt to the trigger (arrivalSentence, the work queue, the entry prompt). They were
// being fed a trigger that misdescribed the process, so this is a DATA correction, not a UI change.
//
// Only processes whose arrival channel is unambiguous are touched. Anything else keeps `on-demand`, which
// is the honest answer for something a person really does start by hand.
//
// IDEMPOTENT. RUN: npx tsx scripts/fix-demo-triggers.mts
import './worker-env.mts';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';

const TRIGGERS: readonly { match: RegExp; kind: string; why: string }[] = [
  { match: /reimbursement/i, kind: 'email', why: 'employees email the invoice' },
  { match: /grievance/i, kind: 'whatsapp', why: 'customers raise grievances on WhatsApp' },
  { match: /fnol|motor.?claim/i, kind: 'whatsapp', why: 'claim intimation arrives on WhatsApp' },
  { match: /death.?claim/i, kind: 'email', why: 'nominees send claim documents by email' },
  { match: /kyc/i, kind: 'email', why: 're-KYC documents arrive by email' },
  { match: /loan underwriting|underwriting assist/i, kind: 'email', why: 'applications arrive by email' },
  // Swept by the bank's own systems rather than an inbound message — a schedule is the honest description.
  { match: /fraud/i, kind: 'schedule', why: 'flagged transactions are swept on a schedule' },
  { match: /delinquency|collections/i, kind: 'schedule', why: 'overdue accounts are swept on a schedule' },
  { match: /renewal|persistency/i, kind: 'schedule', why: 'renewals are driven by due dates' },
];

const rows = (await db.execute(sql`
  SELECT id, org_id, title, trigger FROM apps WHERE org_id IN ('org_bharat','org_suraksha')
`)) as unknown as { rows: { id: string; org_id: string; title: string; trigger: unknown }[] };

let changed = 0;
const untouched: string[] = [];

for (const row of rows.rows ?? []) {
  const rule = TRIGGERS.find((t) => t.match.test(row.title));
  if (!rule) {
    untouched.push(`${row.title} — left on-demand (no unambiguous arrival channel)`);
    continue;
  }
  const current = (row.trigger as { kind?: string } | null)?.kind;
  if (current === rule.kind) continue;

  // Preserve any existing config (a cron, a mailbox) and change only the kind.
  const existing = (row.trigger as Record<string, unknown> | null) ?? {};
  const next = { ...existing, kind: rule.kind };
  await db.execute(sql`UPDATE apps SET trigger = ${JSON.stringify(next)}::jsonb WHERE id = ${row.id}`);
  changed += 1;
  console.log(`${row.org_id} · ${row.title} → ${rule.kind} (${rule.why})`);
}

console.log(`\nretriggered ${changed} app(s)`);
for (const u of untouched) console.log(`  ${u}`);
