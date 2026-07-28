// ─── Purge test/probe residue from the demo tenants (APP_AS_PRODUCT item 2) ─────────────────────────
//
// WHY. Both public demo tenants carried apps created by automated tests and live-verification probes,
// all published and visible to the read-only demo viewer:
//   insurer: 7 apps literally titled "[autotest] …" (reimbursement ×3, competitive intelligence ×4)
//   bank:    "Actions-out webhook proof" ×3, a duplicate "Cross-Sell Advisor", and
//            "Governed CRM follow-up — live verification 2026-07-22"
// For the non-technical persona in docs/APP_AS_PRODUCT.md that reads as a broken product.
//
// SAFETY. Ids are listed EXPLICITLY — no title pattern matching, which could sweep up a real app whose
// name happens to contain a keyword. Each candidate is checked against the SAME reference guards the
// DELETE route enforces (retained action-outcome evidence, solution-deployment history); anything
// referenced is SKIPPED and reported rather than deleted, because tidying a list is never worth
// destroying an audit trail. Runs are left alone — deleteApp does not cascade them.
//
// IDEMPOTENT: an id that is already gone is reported as such, not an error.
//
// RUN: npx tsx scripts/purge-demo-junk-apps.mts
import './worker-env.mts';
import { deleteApp, getApp } from '../src/lib/apps-store.ts';
import { hasActionOutcomesForApp } from '../src/lib/action-outcome-observation-store.ts';
import { hasSolutionDeploymentsForApp } from '../src/lib/solution-blueprints-store.ts';
import { unscheduleApp } from '../src/lib/app-schedules.ts';

const JUNK: readonly { orgId: string; appId: string; why: string }[] = [
  // ── Suraksha Life (insurer): apps created by the automated test suite ──
  { orgId: 'org_suraksha', appId: 'app_597ca4d6', why: '[autotest] Employee reimbursement approval' },
  { orgId: 'org_suraksha', appId: 'app_d9f008e3', why: '[autotest] Employee reimbursement approval' },
  { orgId: 'org_suraksha', appId: 'app_4108cf57', why: '[autotest] Employee reimbursement approval' },
  { orgId: 'org_suraksha', appId: 'app_66ea2e46', why: '[autotest] Product competitive intelligence' },
  { orgId: 'org_suraksha', appId: 'app_b0ee2c1b', why: '[autotest] Product competitive intelligence' },
  { orgId: 'org_suraksha', appId: 'app_b08a5222', why: '[autotest] Product competitive intelligence' },
  { orgId: 'org_suraksha', appId: 'app_84f7bed9', why: '[autotest] Product competitive intelligence' },
  // ── Bharat Union (bank): live-verification probe residue ──
  { orgId: 'org_bharat', appId: 'app_9a76e76f', why: 'Actions-out webhook proof (probe copy)' },
  { orgId: 'org_bharat', appId: 'app_c73426cc', why: 'Actions-out webhook proof (probe copy)' },
  { orgId: 'org_bharat', appId: 'app_5df4c539', why: 'Actions-out webhook proof (probe copy)' },
  { orgId: 'org_bharat', appId: 'app_d07ab6a9', why: 'Governed CRM follow-up — live verification 2026-07-22' },
  // Duplicate Cross-Sell Advisor. app_demo_crosssell is KEPT (the intentional demo id), as is
  // bhapp_xsell "Cross-sell Recommendation" — only the accidental second copy goes.
  { orgId: 'org_bharat', appId: 'app_7402e252', why: 'duplicate Cross-Sell Advisor' },
];

let deleted = 0;
const skipped: string[] = [];
const absent: string[] = [];

for (const entry of JUNK) {
  const app = await getApp(entry.appId, entry.orgId);
  if (!app) {
    absent.push(`${entry.appId} (${entry.why})`);
    continue;
  }

  // The same two guards the DELETE route applies. Referenced evidence outranks a tidy list.
  if (await hasActionOutcomesForApp(entry.appId, entry.orgId)) {
    skipped.push(`${app.title} [${entry.appId}] — has retained business-result evidence`);
    continue;
  }
  if (await hasSolutionDeploymentsForApp(entry.appId, entry.orgId)) {
    skipped.push(`${app.title} [${entry.appId}] — retained by solution deployment history`);
    continue;
  }

  await deleteApp(entry.appId, entry.orgId);
  await unscheduleApp(entry.appId, entry.orgId); // idempotent; a missing schedule is fine
  deleted += 1;
  console.log(`deleted: ${entry.orgId} · ${app.title} [${entry.appId}]`);
}

console.log(`\ndeleted ${deleted}/${JUNK.length}`);
if (absent.length) {
  console.log(`already gone (${absent.length}):`);
  for (const a of absent) console.log(`  - ${a}`);
}
if (skipped.length) {
  console.log(`KEPT because referenced (${skipped.length}) — delete these by hand only if you accept losing the link:`);
  for (const s of skipped) console.log(`  - ${s}`);
}
