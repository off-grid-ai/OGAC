// ─── Seed the BANK's console-owned ETL jobs (org_bharat) ────────────────────────────────────────────
//
// WHY. /data/etl (and /data/flows/orchestration) read listEtlJobs(orgId) (src/lib/etl-jobs-store.ts →
// Postgres table `etl_jobs`) — that table had zero rows for org_bharat, so the page rendered "No ETL
// jobs yet" even though org_bharat already owns four real, live, connected connectors: `bhcon_corebank`
// (Postgres), `bhcon_policyadmin` (MySQL), `bhcon_erp` (MSSQL) and `bhcon_crm` (REST) — see the
// `connectors` table. Mirrors scripts/seed-suraksha-etl-jobs.mts exactly (same createEtlJob()/runJob()
// path, same stg_* convention, same "actually run + verify against the warehouse" discipline); this is
// its bank-tenant counterpart.
//
// WHAT. Authors 5 real EtlJobSpec rows through the REAL createEtlJob()/runJob() path (no hand-written
// SQL insert), one per connector family with two from bhcon_corebank, each moving a genuine table into
// a `bharatunion.stg_*` staging table with real column redaction on the move (masked account number,
// masked PAN on the customer book and on the vendor master, hashed personal names). Bank domain
// throughout — accounts/customers/transactions/vendors/commissions/CRM contacts — deliberately NOT the
// insurance-flavoured tables that happen to also exist on the shared `corebank` Postgres schema
// (`policies`, `claims`, `pricing_rfq`, …, leftovers of the schema this fixture container was cloned
// from): this tenant reads as a bank, so this script never binds a job to those.
//
// The MySQL `bhcon_policyadmin` connector is named "Loan Origination" but the live schema (verified via
// listResources against the connector 2026-08-10) is an agency/commission book — `agents`, `branches`,
// `commissions` — not loan applications; the commissions job below uses what is actually there. Its
// `policy_ref` column is renamed to `loan_ref` on landing (ColumnMapping.dest) precisely so the bank's
// warehouse table never carries an insurance-flavoured column name, even though the source column does.
//
// Each job is actually RUN (not just saved) so lastRunStatus/lastRunAt are real. rowsWritten is
// reported from the run result, never asserted. NOTE: execConnectorRead hard-caps every read at 1000
// rows regardless of rowLimit (src/lib/connector-exec.ts) — expected, not a bug in this script.
//
// IDEMPOTENT: matches existing jobs by name (per org) and UPDATEs instead of duplicating, mirroring
// seed-suraksha-etl-jobs.mts's own convention.
//
// IMPORT ORDER IS LOAD-BEARING: worker-env.mts MUST be first (env before @/db builds its pg Pool).
//
// RUN (on the box, .env.local loaded):
//   /usr/local/bin/node --env-file=.env.local node_modules/.bin/tsx scripts/seed-corebank-etl-jobs.mts
import './worker-env.mts';
import { createEtlJob, listEtlJobs, runJob, updateEtlJob } from '../src/lib/etl-jobs-store.ts';

const ORG = 'org_bharat';

interface JobPlan {
  name: string;
  sourceConnectorId: string;
  sourceResource: string;
  destTable: string;
  mappings: { source: string; dest?: string; action?: 'keep' | 'mask' | 'hash' | 'tokenize' | 'drop' | 'detect'; keepLast?: number }[];
}

const JOBS: JobPlan[] = [
  {
    name: 'Core Banking Accounts to Warehouse',
    sourceConnectorId: 'bhcon_corebank',
    sourceResource: 'accounts',
    destTable: 'stg_accounts',
    mappings: [
      { source: 'id', dest: 'account_id' },
      { source: 'customer_id' },
      { source: 'account_no', action: 'mask', keepLast: 4 },
      { source: 'type' },
      { source: 'ifsc' },
      { source: 'balance' },
      { source: 'status' },
      { source: 'opened_at' },
    ],
  },
  {
    name: 'Customer KYC Register to Warehouse',
    sourceConnectorId: 'bhcon_corebank',
    sourceResource: 'customers',
    destTable: 'stg_customers',
    mappings: [
      { source: 'id', dest: 'customer_id' },
      { source: 'name', action: 'hash' },
      { source: 'email', action: 'hash' },
      { source: 'city' },
      { source: 'kyc_status' },
      { source: 'created_at' },
      { source: 'pan', action: 'mask', keepLast: 4 },
    ],
  },
  {
    name: 'Vendor Payables Master to Warehouse',
    sourceConnectorId: 'bhcon_erp',
    sourceResource: 'vendors',
    destTable: 'stg_vendors',
    mappings: [
      { source: 'id', dest: 'vendor_id' },
      { source: 'name' },
      { source: 'gstin' },
      { source: 'city' },
      { source: 'category' },
      { source: 'pan', action: 'mask', keepLast: 4 },
    ],
  },
  {
    name: 'Agency Commission Ledger to Warehouse',
    sourceConnectorId: 'bhcon_policyadmin',
    sourceResource: 'commissions',
    destTable: 'stg_commissions',
    mappings: [
      { source: 'id', dest: 'commission_id' },
      { source: 'agent_id' },
      { source: 'policy_ref', dest: 'loan_ref' }, // bank-flavoured landing name — see file header
      { source: 'amount' },
      { source: 'paid_on' },
    ],
  },
  {
    name: 'Corporate Relationship Contacts to Warehouse',
    sourceConnectorId: 'bhcon_crm',
    sourceResource: 'contacts',
    destTable: 'stg_contacts',
    mappings: [
      { source: 'id', dest: 'contact_id' },
      { source: 'account_id' },
      { source: 'name', action: 'hash' },
      { source: 'title' },
      { source: 'email', action: 'hash' },
    ],
  },
];

async function main() {
  const existing = await listEtlJobs(ORG);
  const byName = new Map(existing.map((j) => [j.name, j]));

  for (const plan of JOBS) {
    const draft = {
      name: plan.name,
      sourceConnectorId: plan.sourceConnectorId,
      sourceResource: plan.sourceResource,
      destDatabase: 'bharatunion',
      destTable: plan.destTable,
      mappings: plan.mappings,
      trigger: 'manual' as const,
      rowLimit: 5000,
    };

    const already = byName.get(plan.name);
    const result = already
      ? await updateEtlJob(already.id, draft, ORG)
      : await createEtlJob(draft, ORG);

    if (!result || !result.ok) {
      console.log(`!  ${plan.name}: FAILED to save — ${JSON.stringify((result as { errors?: string[] } | null)?.errors ?? 'job not found')}`);
      continue;
    }
    console.log(`${already ? 'updated' : 'created'}  ${plan.name}  (${result.job.id})`);

    console.log(`   running "${plan.name}" ...`);
    const run = await runJob(result.job, ORG);
    console.log(
      `   -> ${run.status}  read=${run.rowsRead} written=${run.rowsWritten} redacted=${run.redacted}  ${run.message}`,
    );
  }

  console.log('\n== final state ==');
  const final = await listEtlJobs(ORG);
  for (const j of final) {
    console.log(`${j.id}  ${j.name}  ${j.sourceResource} -> ${j.destDatabase}.${j.destTable}  last=${j.lastRunStatus ?? 'never'}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
