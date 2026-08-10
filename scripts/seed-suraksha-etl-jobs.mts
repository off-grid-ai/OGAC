// ─── Seed the INSURER's console-owned ETL jobs (org_suraksha) ───────────────────────────────────
//
// WHY. /data/etl and /data/flows/orchestration both read listEtlJobs(orgId) (src/lib/etl-jobs-store.ts
// → Postgres table `etl_jobs`, self-migrating, NOT named after Airbyte/Kestra — traced from the
// EtlJobsContent component, not guessed). That table had zero rows for org_suraksha, so both pages
// rendered "No ETL jobs yet" even though org_suraksha already owns real, live source connectors
// (`surcon_coreins` Postgres, `surcon_policyadmin` MySQL — see the `connectors` table) pointed at a
// real OLTP box with real insurer data (policies/claims/premiums/advisors).
//
// WHAT. Authors 4 real EtlJobSpec rows through the REAL createEtlJob()/runJob() path (no hand-written
// SQL insert — this exercises the exact same validation + governed direct-copy engine the "New job" /
// "Run now" buttons use), each moving a genuine table from a genuine source connector into a staging
// table in the ClickHouse `suraksha` warehouse database, WITH real column redaction on the move
// (masked PAN, hashed nominee/claimant names, PII-detected medical free text). Destination tables are
// named `stg_*` — deliberately separate from the curated dim_/fact_ analytics tables seeded by
// scripts/seed-suraksha-warehouse.mts, so a re-run of either script never clobbers the other's rows.
//
// Each job is actually RUN (not just saved) so lastRunStatus/lastRunAt are real, and rowsWritten is
// verified against the warehouse afterward — never asserted, only reported.
//
// IDEMPOTENT: matches existing jobs by name (per org) and UPDATEs instead of duplicating, mirroring
// scripts/seed-app-templates.mts's convention.
//
// IMPORT ORDER IS LOAD-BEARING: worker-env.mts MUST be first (env before @/db builds its pg Pool).
//
// RUN (on the box, .env.local loaded):
//   /usr/local/bin/node --env-file=.env.local node_modules/.bin/tsx scripts/seed-suraksha-etl-jobs.mts
import './worker-env.mts';
import { createEtlJob, listEtlJobs, runJob, updateEtlJob } from '../src/lib/etl-jobs-store.ts';

const ORG = 'org_suraksha';

interface JobPlan {
  name: string;
  sourceConnectorId: string;
  sourceResource: string;
  destTable: string;
  mappings: { source: string; dest?: string; action?: 'keep' | 'mask' | 'hash' | 'tokenize' | 'drop' | 'detect'; keepLast?: number }[];
}

const JOBS: JobPlan[] = [
  {
    name: 'Core Insurance Policies to Warehouse',
    sourceConnectorId: 'surcon_coreins',
    sourceResource: 'policies',
    destTable: 'stg_policies',
    mappings: [
      { source: 'policy_no' },
      { source: 'holder_name' },
      { source: 'pan', action: 'mask', keepLast: 4 },
      { source: 'plan_type' },
      { source: 'sum_assured_inr' },
      { source: 'annual_premium_inr' },
      { source: 'premium_mode' },
      { source: 'status' },
      { source: 'issue_date' },
      { source: 'maturity_date' },
      { source: 'nominee_name', action: 'hash' },
      { source: 'city' },
    ],
  },
  {
    name: 'Claims Register to Warehouse',
    sourceConnectorId: 'surcon_coreins',
    sourceResource: 'claims',
    destTable: 'stg_claims',
    mappings: [
      { source: 'claim_id' },
      { source: 'policy_no' },
      { source: 'claimant_name', action: 'hash' },
      { source: 'claim_type' },
      { source: 'intimated_date' },
      { source: 'cause_of_death', action: 'detect' }, // free-text medical detail — PII-scan on the way
      { source: 'sum_assured_inr' },
      { source: 'claim_amount_inr' },
      { source: 'contestability_flag' },
      { source: 'status' },
      { source: 'fnol_channel' },
    ],
  },
  {
    name: 'Premium Payment Ledger to Warehouse',
    sourceConnectorId: 'surcon_coreins',
    sourceResource: 'premiums',
    destTable: 'stg_premiums',
    mappings: [
      { source: 'premium_id' },
      { source: 'policy_no' },
      { source: 'amount_inr' },
      { source: 'due_date' },
      { source: 'paid_date' },
      { source: 'mode' },
      { source: 'status' },
    ],
  },
  {
    name: 'Advisor Roster to Warehouse',
    sourceConnectorId: 'surcon_policyadmin',
    sourceResource: 'advisors',
    destTable: 'stg_advisors',
    mappings: [
      { source: 'advisor_code' },
      { source: 'full_name' },
      { source: 'license_no' },
      { source: 'region' },
      { source: 'city' },
      { source: 'persistency_13m_pct' },
      { source: 'persistency_61m_pct' },
      { source: 'policies_sold_ytd' },
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
      destDatabase: 'suraksha',
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
