// ─── Grade what the demo tenants' apps actually read ───────────────────────────────────────────────
//
// Classification existed on the warehouse catalogue and was populated (23 rows, 12 assets) — but apps
// read DATA DOMAINS, and the two inventories were never joined, so the grade could not reach a run.
// Domains carry a level now; this grades the demo ones the way a BFSI data office would, so the CISO
// question answers with real values rather than a column of nulls.
//
// The grades are not arbitrary. Under DPDP, identity and financial records are the sensitive
// categories; reference and pricing data is internal; nothing here is public.
//
//   /usr/local/bin/node --env-file=.env.local ./node_modules/.bin/tsx scripts/classify-demo-domains.mts [--apply]

import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';

const APPLY = process.argv.includes('--apply');

// Matched on the domain LABEL, most specific first.
const GRADES: { match: RegExp; level: string; why: string }[] = [
  // Identity documents and KYC evidence — the most sensitive thing either tenant holds.
  { match: /kyc|aadhaar|pan\b|identity|ovd/i, level: 'restricted', why: 'identity documents' },
  { match: /claim documents|claim_documents/i, level: 'restricted', why: 'claim evidence incl. medical' },
  // Customer, account, policy and money movement — personal financial data.
  { match: /customer|account|policyholder|advisor/i, level: 'confidential', why: 'personal customer data' },
  { match: /transaction|repayment|premium|payment|quota|expense|invoice|claim/i, level: 'confidential', why: 'personal financial data' },
  { match: /polic(y|ies)/i, level: 'confidential', why: 'policy records' },
  { match: /helpdesk|grievance|case/i, level: 'confidential', why: 'customer correspondence' },
  // Employee-related but not customer-identifying.
  { match: /candidate|job requisition|vendor/i, level: 'internal', why: 'internal HR / procurement' },
  // Reference data — no personal data in it.
  { match: /pricing|rate card|rfq|competitor|branch|product|general ledger|risk signal/i, level: 'internal', why: 'reference data' },
];

// The app self-migrates this column on first use, but a script runs before the app has been hit —
// so ensure it here too rather than failing with "column does not exist".
await db.execute(sql`ALTER TABLE data_domains ADD COLUMN IF NOT EXISTS classification text;`);
await db.execute(sql`ALTER TABLE app_runs ADD COLUMN IF NOT EXISTS data_classification text;`);

const domains = await db.execute<{ id: string; org_id: string; label: string; classification: string | null }>(sql`
  SELECT id, org_id, label, classification FROM data_domains
  WHERE org_id IN ('org_bharat','org_suraksha') ORDER BY org_id, label`);

let graded = 0;
let ungraded = 0;
for (const d of domains.rows) {
  const hit = GRADES.find((g) => g.match.test(d.label));
  if (!hit) {
    ungraded++;
    console.log(`? ${d.org_id} ${d.label.padEnd(36)} NO RULE — left unclassified, which is reported as such`);
    continue;
  }
  console.log(`  ${d.org_id} ${d.label.padEnd(36)} ${hit.level.padEnd(13)} ${hit.why}`);
  if (APPLY) {
    await db.execute(sql`UPDATE data_domains SET classification = ${hit.level} WHERE id = ${d.id}`);
  }
  graded++;
}

console.log(`\n${APPLY ? 'graded' : 'would grade'} ${graded} · left unclassified ${ungraded}`);

if (APPLY) {
  const summary = await db.execute<{ org_id: string; classification: string | null; n: number }>(sql`
    SELECT org_id, classification, count(*)::int n FROM data_domains
    WHERE org_id IN ('org_bharat','org_suraksha') GROUP BY org_id, classification ORDER BY org_id, n DESC`);
  console.log('\nafter:');
  for (const r of summary.rows) console.log(`  ${r.org_id} ${(r.classification ?? 'unclassified').padEnd(14)} ${r.n}`);
}
process.exit(0);
