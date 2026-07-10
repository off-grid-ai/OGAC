// ─── DEMO-READY infra seed (WAVE 2, agent E) — STORAGE file BYTES → object store ─────────────────
//
// Agent C's Postgres seed writes the file-metadata story but FLAGGED that the actual file BYTES must
// be uploaded to the object store (SeaweedFS/S3) — that needs the infra the operator runs. This
// script does exactly that step: it uploads agent C's demo file bodies (src/lib/demo/storage.ts) to
// the SAME media bucket the console reads, keyed UNDER the owning tenant's prefix so the Storage
// screen (scoped to org_bharat / org_suraksha) shows real files instead of empty / global junk.
//
//   • BANK files (statements, KYC, dunning)  → org_bharat   (orgs/org_bharat/demo/…)
//   • INSURER files (policy, FNOL, manifest)  → org_suraksha (orgs/org_suraksha/demo/…)
//
// SAFETY (non-negotiable): targets ONLY org_bharat / org_suraksha keys — assertDemoOrg guards every
// write. IDEMPOTENT: a DETERMINISTIC key (infra-seed.demoFileKey → orgs/<org>/demo/<slug>) means a
// re-run OVERWRITES the same object, never duplicates (unlike saveFile's random-uuid keys). Reuses
// the SAME S3 put path agent A wired (files.putObject) — no re-implemented S3.
//
// HOW TO RUN (from the console dir, .env.local / .env.production loaded):
//   npx tsx scripts/seed-tenant-files.mts                     # both tenants
//   OFFGRID_SEED_TENANT=org_bharat npx tsx scripts/seed-tenant-files.mts   # one tenant
//   OFFGRID_SEED_DRY_RUN=1 npx tsx scripts/seed-tenant-files.mts           # print plan, upload nothing
//
// IMPORT ORDER: worker-env.mts first so OFFGRID_SEAWEEDFS_URL loads before files.ts reads it.
import './worker-env.mts';
import { putObject, listFiles } from '../src/lib/files.ts';
import { filesFor } from '../src/lib/demo/storage.ts';
import { assertDemoOrg, demoFileKey, DEMO_ORG_IDS, type DemoOrgId } from '../src/lib/demo/infra-seed.ts';
import { BHARAT_PROFILE, SURAKSHA_PROFILE, type TenantProfile } from '../src/lib/tour-demo-seed.ts';

const log = (...a: unknown[]) => console.log('[seed:files]', ...a);
const DRY = process.env.OFFGRID_SEED_DRY_RUN === '1' || process.env.OFFGRID_SEED_DRY_RUN === 'true';

const PROFILE_BY_ORG: Record<DemoOrgId, TenantProfile> = {
  org_bharat: BHARAT_PROFILE,
  org_suraksha: SURAKSHA_PROFILE,
};

interface UploadPlan {
  orgId: DemoOrgId;
  key: string;
  name: string;
  mime: string;
  bytes: number;
  body: string;
}

/** Build the deterministic upload plan for one tenant — pure mapping over agent C's file bodies. */
function planFor(orgId: DemoOrgId): UploadPlan[] {
  assertDemoOrg(orgId);
  const profile = PROFILE_BY_ORG[orgId];
  return filesFor(profile).map((f) => ({
    orgId,
    key: demoFileKey(orgId, f.name),
    name: f.name,
    mime: f.mime,
    bytes: Buffer.byteLength(f.content),
    body: f.content,
  }));
}

async function uploadPlan(plan: UploadPlan[]): Promise<void> {
  for (const p of plan) {
    if (DRY) {
      log(`  [dry] would PUT ${p.key} (${p.mime}, ${p.bytes} bytes)`);
      continue;
    }
    // putObject at a DETERMINISTIC key → idempotent overwrite (never a duplicate).
    await putObject(p.key, p.body, p.mime);
    log(`  ✓ PUT ${p.key} (${p.mime}, ${p.bytes} bytes)`);
  }
}

async function main(): Promise<void> {
  const only = process.env.OFFGRID_SEED_TENANT;
  const orgIds: DemoOrgId[] = only
    ? (DEMO_ORG_IDS.filter((o) => o === only) as DemoOrgId[])
    : [...DEMO_ORG_IDS];
  if (only && orgIds.length === 0) {
    throw new Error(`unknown OFFGRID_SEED_TENANT "${only}" (expected ${DEMO_ORG_IDS.join(' or ')})`);
  }

  log(DRY ? '── DRY RUN (no writes) ──' : `── uploading demo files to ${process.env.OFFGRID_SEAWEEDFS_URL || 'http://127.0.0.1:8333'} ──`);
  const summary: string[] = [];
  for (const orgId of orgIds) {
    const plan = planFor(orgId);
    log(`${orgId}: ${plan.length} files → ${demoFileKey(orgId, 'x').replace(/x$/, '')}…`);
    try {
      await uploadPlan(plan);
      summary.push(`${orgId}: ${plan.length} files ${DRY ? 'planned' : 'uploaded'} under orgs/${orgId}/demo/`);
    } catch (e) {
      const msg = (e as Error).message;
      summary.push(`${orgId}: FAILED — object store unreachable? (${msg}). The file BODIES are in src/lib/demo/storage.ts; run this against a reachable SeaweedFS.`);
      log(`  ✗ ${orgId}: ${msg}`);
    }
  }

  // Verify what the tenant will actually SEE (the org-scoped list), unless a dry run.
  if (!DRY) {
    for (const orgId of orgIds) {
      try {
        const listed = await listFiles('', { orgId }).catch(() => []);
        const demo = listed.filter((f) => f.id.startsWith(`orgs/${orgId}/demo/`));
        log(`${orgId}: Storage screen now lists ${demo.length} demo file(s): ${demo.map((f) => f.name).join(', ')}`);
      } catch {
        /* listing is best-effort verification, not load-bearing */
      }
    }
  }

  log('');
  log('════ SUMMARY ════');
  for (const s of summary) log(`  • ${s}`);
  log('done.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed:files] FAILED:', err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  });
