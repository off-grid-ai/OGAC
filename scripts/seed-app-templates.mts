// ─── Publish the real tenant processes as adoptable templates (APP_AS_PRODUCT item 1) ──────────────
//
// WHY. The Templates surface had ZERO rows in both demo tenants while the adoption machinery
// (publishAppAsTemplate, TemplateAdoptForm, listTemplates) was fully built. So the entry point a
// NON-TECHNICAL person needs most — "I recognise my process, start me there" — dead-ended on an empty
// page, and their only remaining option was a blank prompt. That is the opposite of the acceptance bar
// in docs/APP_AS_PRODUCT.md. This was a data gap, not a build gap.
//
// WHAT. Publishes a handful of genuine BFSI apps already seeded in each tenant as org-visible
// templates, through the REAL publishAppAsTemplate path (same validation, slug minting and audit as
// the "Publish as template" button) rather than direct SQL.
//
// VAR SCHEMA IS DELIBERATELY EMPTY. These apps contain no {{placeholder}} tokens, and
// app-template-vars.ts honestly reports a declared-but-absent var as an unbound gap. Declaring vars
// that the spec does not reference would manufacture warnings on a working template. Parameterising
// them (owner email, SLA hours, escalation channel) means editing the app specs first — a separate,
// deliberate change.
//
// IDEMPOTENT: publishing an app that is already a template just re-asserts the same row.
//
// RUN (from the console dir, .env.local loaded):
//   npx tsx scripts/seed-app-templates.mts
//
// IMPORT ORDER IS LOAD-BEARING: worker-env.mts must come first so .env.* is read before @/db builds
// its pg Pool (same rationale as scripts/seed-demo-tenants.mts).
import './worker-env.mts';
import { publishAppAsTemplate } from '../src/lib/apps-store.ts';

/** Apps chosen because a department person would recognise the PROCESS by name. */
const TEMPLATES: readonly { orgId: string; appId: string; note: string }[] = [
  // Bharat Union (bank)
  { orgId: 'org_bharat', appId: 'bhapp_kyc', note: 'KYC & Re-KYC Verification' },
  { orgId: 'org_bharat', appId: 'bhapp_loan', note: 'Personal Loan Underwriting' },
  { orgId: 'org_bharat', appId: 'bhapp_reimb', note: 'Reimbursement Approval' },
  // Suraksha Life (insurer)
  { orgId: 'org_suraksha', appId: 'app_ee620a01', note: 'Motor-Claim FNOL Intake' },
  { orgId: 'org_suraksha', appId: 'app_14940314', note: 'Death-Claim Assessment' },
  { orgId: 'org_suraksha', appId: 'app_0b5f3061', note: 'Grievance Resolution Assist' },
];

let published = 0;
const missing: string[] = [];

for (const entry of TEMPLATES) {
  const result = await publishAppAsTemplate(entry.appId, entry.orgId, {
    varSchema: { vars: [] },
    visibility: 'org',
  });
  if (!result) {
    // Honest: an id absent from that org is reported, never silently skipped — a template list that
    // is quietly shorter than intended is how this surface ended up empty in the first place.
    missing.push(`${entry.orgId}/${entry.appId} (${entry.note})`);
    continue;
  }
  published += 1;
  console.log(`template: ${entry.orgId} · ${result.title} · slug=${result.slug}`);
}

console.log(`\npublished ${published}/${TEMPLATES.length} templates`);
if (missing.length) {
  console.log('NOT FOUND in its org (nothing published for these):');
  for (const m of missing) console.log(`  - ${m}`);
  process.exitCode = 1;
}
