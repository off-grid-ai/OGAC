// ─── DEMO-READY infra seed (WAVE 2, agent E) — SECRET VALUES → vault (OpenBao) ───────────────────
//
// Agent C's Postgres seed writes the secret-metadata rows but FLAGGED that the secret VALUES must be
// written to the vault (OpenBao) — only FAKE placeholders live in git. This script emits the
// `bao kv put <path> value=<v>` commands to set those values, per tenant, UNDER the tenant's vault
// scope (secret/org_bharat/… · secret/org_suraksha/…). Values are GENERATED at run time (a fake API
// key / DB password) and NEVER committed — nothing real is embedded here.
//
// SAFE BY DEFAULT: prints the commands + a summary and writes NOTHING. Pass --write (and a reachable
// OFFGRID_OPENBAO_URL) to actually POST the values via the vault adapter (openBaoSecrets.set) — the
// SAME write path the console's Secrets surface uses. Idempotent either way: `bao kv put` / KV v2
// overwrites the path in place (a re-run bumps the version, never duplicates a path).
//
// SAFETY (non-negotiable): only secret/org_bharat/* and secret/org_suraksha/* paths — assertDemoOrg
// + the fact that agent C's paths are already tenant-scoped guard this.
//
// HOW TO RUN (from the console dir):
//   npx tsx scripts/seed-tenant-secrets.mts                       # print bao commands, write nothing
//   OFFGRID_SEED_TENANT=org_suraksha npx tsx scripts/seed-tenant-secrets.mts   # one tenant
//   npx tsx scripts/seed-tenant-secrets.mts --write               # actually write via the vault adapter
//
// IMPORT ORDER: worker-env.mts first so OFFGRID_OPENBAO_URL/TOKEN load before the adapter reads them.
import './worker-env.mts';
import { randomBytes } from 'node:crypto';
import { secretsFor } from '../src/lib/demo/secrets.ts';
import { baoPutCommand, fakeSecretValue, assertDemoOrg, DEMO_ORG_IDS, type DemoOrgId } from '../src/lib/demo/infra-seed.ts';
import { BHARAT_PROFILE, SURAKSHA_PROFILE, type TenantProfile } from '../src/lib/tour-demo-seed.ts';

const log = (...a: unknown[]) => console.log('[seed:secrets]', ...a);
const WRITE = process.argv.includes('--write');

const PROFILE_BY_ORG: Record<DemoOrgId, TenantProfile> = {
  org_bharat: BHARAT_PROFILE,
  org_suraksha: SURAKSHA_PROFILE,
};

// A fresh random token per value — the injected generator that keeps infra-seed's builders pure.
const randToken = () => randomBytes(9).toString('hex');

interface SecretPlan {
  orgId: DemoOrgId;
  name: string;
  path: string;
  value: string;
  command: string;
  note: string;
}

/** Build the write plan for one tenant — a fake value + its `bao kv put` command per secret. */
function planFor(orgId: DemoOrgId): SecretPlan[] {
  assertDemoOrg(orgId);
  const profile = PROFILE_BY_ORG[orgId];
  return secretsFor(profile).map((s) => {
    const value = fakeSecretValue(s, randToken);
    return { orgId, name: s.name, path: s.path, value, command: baoPutCommand(s, value), note: s.note };
  });
}

async function main(): Promise<void> {
  const only = process.env.OFFGRID_SEED_TENANT;
  const orgIds: DemoOrgId[] = only
    ? (DEMO_ORG_IDS.filter((o) => o === only) as DemoOrgId[])
    : [...DEMO_ORG_IDS];
  if (only && orgIds.length === 0) {
    throw new Error(`unknown OFFGRID_SEED_TENANT "${only}" (expected ${DEMO_ORG_IDS.join(' or ')})`);
  }

  const plans = orgIds.flatMap(planFor);

  log('════ RUN THESE (writes fake demo secret VALUES to the vault) ════');
  log('# Requires the OpenBao CLI authenticated to your vault (bao login / VAULT_TOKEN).');
  for (const p of plans) log(`  ${p.command}    # ${p.orgId} · ${p.name}`);
  log('');

  if (WRITE) {
    // --write: push via the SAME adapter the console's Secrets surface uses. The KV mount is `secret`,
    // and the adapter keys under <mount>/data/<key>, so we strip the leading `secret/` from the path.
    const { openBaoSecrets, openBaoConfigured } = await import('../src/lib/adapters/secrets.ts');
    if (!openBaoConfigured()) {
      log('✗ --write given but OFFGRID_OPENBAO_URL is unset — printed the commands above; nothing written.');
    } else {
      for (const p of plans) {
        const key = p.path.replace(/^secret\//, '');
        try {
          await openBaoSecrets.set!(key, p.value);
          log(`  ✓ wrote ${p.path} (${p.orgId} · ${p.name})`);
        } catch (e) {
          log(`  ✗ FAILED ${p.path}: ${(e as Error).message} — run the printed command manually.`);
        }
      }
    }
    log('');
  }

  log('════ SUMMARY ════');
  for (const orgId of orgIds) {
    const forOrg = plans.filter((p) => p.orgId === orgId);
    log(`  • ${orgId}: ${forOrg.length} secret(s) under secret/${orgId}/ — ${forOrg.map((p) => p.name).join(', ')}`);
  }
  log(WRITE ? 'done (write attempted — see per-secret results above).' : 'done (dry — run with --write, or paste the commands above into an authenticated `bao` shell).');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed:secrets] FAILED:', err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  });
