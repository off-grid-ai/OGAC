// ─── Record WHY the demo tenants may process each source, and WHAT FOR ─────────────────────────────
//
// Lawful basis and purpose now exist on data domains, but a column of nulls answers a DPO's question
// with "we don't know" — which is honest and useless for a demo. This grades the demo tenants' sources
// the way a BFSI data office actually would under DPDP 2023.
//
// The bases are not arbitrary. Money movement and policy servicing are CONTRACT (needed to deliver
// what the customer asked for). KYC and AML are REQUIRED BY LAW. Fraud and risk signals are
// LEGITIMATE USE. Marketing-adjacent and enrichment data is CONSENT. Staff data is EMPLOYMENT.
// Reference data with no personal data in it is left ungrounded on purpose — a lawful basis for
// processing personal data is meaningless where there is none, and the count of gaps stays honest.
//
//   /usr/local/bin/node --env-file=.env.local ./node_modules/.bin/tsx scripts/ground-demo-domains.mts [--apply]

import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';

const APPLY = process.argv.includes('--apply');

// Matched on the domain LABEL, most specific first.
const GROUNDS: { match: RegExp; basis: string; purpose: string }[] = [
  // Required by law — we hold these because a regulator requires it, not because anyone consented.
  { match: /kyc|aadhaar|pan\b|identity|ovd/i, basis: 'legal-obligation', purpose: 'Verifying customer identity as required by KYC rules' },
  { match: /aml|sanction|regulatory report/i, basis: 'legal-obligation', purpose: 'Anti-money-laundering monitoring and regulatory reporting' },
  // Contract — needed to deliver the product the customer asked for.
  { match: /claim/i, basis: 'contract', purpose: 'Assessing and settling claims under the policy' },
  { match: /polic(y|ies)|policyholder|premium/i, basis: 'contract', purpose: 'Administering and servicing the customer policy' },
  { match: /transaction|repayment|payment|account|expense|invoice/i, basis: 'contract', purpose: 'Operating the customer account and processing payments' },
  { match: /customer/i, basis: 'contract', purpose: 'Operating the customer relationship and servicing requests' },
  { match: /helpdesk|grievance|case/i, basis: 'contract', purpose: 'Handling customer requests and complaints' },
  // Legitimate use — permitted without consent.
  { match: /fraud|risk signal|dispute|chargeback/i, basis: 'legitimate-use', purpose: 'Detecting and preventing fraud and financial crime' },
  // Employment.
  { match: /candidate|job requisition|employee|payroll|advisor/i, basis: 'employment', purpose: 'Recruitment and staff administration' },
  // Consent — data we only hold because the person agreed to it.
  { match: /marketing|campaign|preference|consent|newsletter/i, basis: 'consent', purpose: 'Sending communications the customer opted in to' },
];

// Sources that hold NO personal data. Left ungrounded deliberately, and reported as such.
const NO_PERSONAL_DATA = /pricing|rate card|rfq|competitor|branch|product catalog|general ledger|quota/i;

await db.execute(sql`ALTER TABLE data_domains ADD COLUMN IF NOT EXISTS lawful_basis text;`);
await db.execute(sql`ALTER TABLE data_domains ADD COLUMN IF NOT EXISTS purpose text;`);

const domains = await db.execute<{
  id: string;
  org_id: string;
  label: string;
  lawful_basis: string | null;
  classification: string | null;
}>(sql`
  SELECT id, org_id, label, lawful_basis, classification FROM data_domains
  WHERE org_id IN ('org_bharat','org_suraksha') ORDER BY org_id, label`);

let grounded = 0;
let noPersonalData = 0;
let unmatched = 0;
for (const d of domains.rows) {
  // The no-personal-data exemption must DEFER TO THE CLASSIFICATION. 'reimbursement quota' matched the
  // label pattern and was exempted while being graded confidential — i.e. the two governance answers
  // for one source contradicted each other. Confidential or restricted means personal data is in
  // there, so a lawful basis is required whatever the label looks like.
  const gradedSensitive = d.classification === 'confidential' || d.classification === 'restricted';
  if (NO_PERSONAL_DATA.test(d.label) && !gradedSensitive) {
    noPersonalData++;
    console.log(`  ${d.org_id} ${d.label.padEnd(34)} — no personal data, deliberately left ungrounded`);
    continue;
  }
  const hit = GROUNDS.find((g) => g.match.test(d.label));
  if (!hit && gradedSensitive) {
    // Graded sensitive but no rule matched: this is a real gap that a human must close, and it is
    // reported loudly rather than being given a plausible-looking default basis.
    unmatched++;
    console.log(`! ${d.org_id} ${d.label.padEnd(34)} ${String(d.classification).padEnd(13)} GRADED SENSITIVE, NO BASIS RULE — needs a human`);
    continue;
  }
  if (!hit) {
    unmatched++;
    console.log(`? ${d.org_id} ${d.label.padEnd(34)} NO RULE — stays a recorded gap`);
    continue;
  }
  console.log(`  ${d.org_id} ${d.label.padEnd(34)} ${hit.basis.padEnd(17)} ${hit.purpose}`);
  if (APPLY) {
    await db.execute(sql`
      UPDATE data_domains SET lawful_basis = ${hit.basis}, purpose = ${hit.purpose} WHERE id = ${d.id}`);
  }
  grounded++;
}

console.log(
  `\n${APPLY ? 'grounded' : 'would ground'} ${grounded} · no personal data ${noPersonalData} · unmatched gaps ${unmatched}`,
);

if (APPLY) {
  const after = await db.execute<{ org_id: string; lawful_basis: string | null; n: number }>(sql`
    SELECT org_id, lawful_basis, count(*)::int n FROM data_domains
    WHERE org_id IN ('org_bharat','org_suraksha') GROUP BY org_id, lawful_basis ORDER BY org_id, n DESC`);
  console.log('\nafter:');
  for (const r of after.rows) {
    console.log(`  ${r.org_id} ${(r.lawful_basis ?? 'NO BASIS RECORDED').padEnd(20)} ${r.n}`);
  }
}
process.exit(0);
