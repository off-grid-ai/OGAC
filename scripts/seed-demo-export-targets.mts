// ─── Seed export targets for the demo tenants ──────────────────────────────────────────────────────
//
// LIVE FINDING (2026-08-10). /governance/evidence/export measured 148 characters on BOTH demo
// tenants (insurer and bank) — byte-identical, which is the tell that this isn't missing tenant
// data in the usual sense: `listExportTargets()` returns zero rows for every org on this deployment,
// including `default`. Nobody has ever configured an export target here. The feature (stream the
// audit/lineage/metrics spine to the enterprise's own SIEM/catalog/observability stack) is real and
// fully built (src/lib/exporters/*) — it has just never been exercised, so a CISO landing on this
// page saw a config screen with nothing configured.
//
// This seeds ONE target per kind, through the product's own `createExportTarget()` (never a raw
// INSERT), for each demo tenant. The audit/lineage endpoints point at the tenant's OWN fictitious
// SIEM/catalog (plausible, not reachable — exactly like a customer who has just wired the
// integration and hasn't run "Test" yet: enabled=true, lastStatus=null, "Never tested"). The metrics
// target is left with a BLANK endpoint (scrape mode) and then really Tested via testTarget() — that
// mode makes no network call and is unconditionally correct, so recording it as "ok" is the real
// outcome of a real function, not a fabricated one.
//
// Idempotent: skips any (org, kind) that already has a target.
//
// Run ON the box (tsx, reads .env.local):
//   cd ~/offgrid/console && /usr/local/bin/node --env-file=.env.local node_modules/.bin/tsx \
//     scripts/seed-demo-export-targets.mts [--dry]

import { createExportTarget, listExportTargets } from '../src/lib/exporters/store.ts';
import { testTarget } from '../src/lib/exporters/run.ts';

const DRY = process.argv.includes('--dry');

interface TargetSeed {
  kind: 'audit' | 'lineage' | 'metrics';
  endpoint: string;
  secretRef: string | null;
  testAfterCreate: boolean;
}

interface TenantSeed {
  orgId: string;
  domain: string; // the tenant's own fictitious enterprise domain, for a plausible endpoint
}

const TENANTS: readonly TenantSeed[] = [
  { orgId: 'org_suraksha', domain: 'surakshalife.example' },
  { orgId: 'org_bharat', domain: 'bharatunion.example' },
];

function targetsFor(domain: string): readonly TargetSeed[] {
  return [
    {
      kind: 'audit',
      endpoint: `https://splunk.${domain}:8088`,
      secretRef: 'splunk/hec-token',
      testAfterCreate: false,
    },
    {
      kind: 'lineage',
      endpoint: `https://catalog.${domain}/api/v1/lineage`,
      secretRef: null,
      testAfterCreate: false,
    },
    {
      kind: 'metrics',
      endpoint: '', // blank = scrape mode; Prometheus pulls from /api/v1/exporters/metrics
      secretRef: null,
      testAfterCreate: true, // scrape-mode test() makes no network call and is always correct
    },
  ];
}

function log(...args: unknown[]) {
  console.log(...args);
}

async function main() {
  log(DRY ? '── DRY RUN ──' : '── applying ──');

  for (const tenant of TENANTS) {
    const existing = await listExportTargets(tenant.orgId);
    const haveKinds = new Set(existing.map((t) => t.kind));
    log(`\n${tenant.orgId}: ${existing.length} existing target(s) (${[...haveKinds].join(', ') || 'none'})`);

    for (const seed of targetsFor(tenant.domain)) {
      if (haveKinds.has(seed.kind)) {
        log(`  = ${seed.kind} already configured, skipping`);
        continue;
      }
      if (DRY) {
        log(`  would create ${seed.kind} -> ${seed.endpoint || '(scrape mode)'}`);
        continue;
      }
      const created = await createExportTarget(
        { kind: seed.kind, endpoint: seed.endpoint, enabled: true, secretRef: seed.secretRef },
        tenant.orgId,
      );
      log(`  created ${seed.kind} target ${created.id} -> ${seed.endpoint || '(scrape mode)'}`);
      if (seed.testAfterCreate) {
        const probe = await testTarget(created.id, tenant.orgId);
        log(`    tested: ok=${probe.ok} detail="${probe.detail}"`);
      }
    }
  }

  log('\n── after ──');
  for (const tenant of TENANTS) {
    const after = await listExportTargets(tenant.orgId);
    log(`${tenant.orgId}: ${after.length} target(s)`);
    for (const t of after) {
      log(`  - ${t.kind} "${t.label}" runnable=${t.runnable} lastStatus=${t.lastStatus ?? 'never tested'}`);
    }
  }
}

await main();
process.exit(0);
