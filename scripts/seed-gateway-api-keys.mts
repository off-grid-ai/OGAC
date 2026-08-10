// ─── Demo seed: one governed API key per demo tenant (Keys tab of /runtime/api-budgets) ──────────
//
// WHY: the one-pager sends buyers to /runtime/api-budgets (redirects to the Keys tab). Traced live
// against the real Keycloak Admin API on the box (scripts/_wt_a39e82_keys_probe.mts, deleted after
// use): `keycloakConfigured() === true` and `listGatewayKeys()` returns a real, empty array — not a
// failing read, not a hard-coded stub. Zero gateway API keys have EVER been minted in this realm
// (the list is realm-wide, not org-scoped — see gateway-api-keys.ts), so every tenant sees "No API
// keys yet — create one…". That is honest, but it leaves the "one governed door" claim with nothing
// to click through to on a cold demo visit.
//
// This script exercises the REAL product action (`createGatewayKey`, the exact function the "New
// key" button in the UI calls) to mint one real Keycloak service-account client per demo tenant, so
// the Keys screen shows a genuine governed machine client rather than fabricated rows in a table we
// don't own. No secret is ever persisted by us — Keycloak holds the hashed secret, same as a key an
// operator created by hand; the one-time plaintext is only ever printed to THIS run's console.
//
// IDEMPOTENT: keys aren't unique by name in Keycloak, so before creating we check for an existing
// key whose (name, ownerOrg attribute) already matches our seed identity and skip it — re-running
// never mints duplicates.
//
// Run from the console dir with env loaded:
//   /usr/local/bin/node --env-file=.env.local node_modules/.bin/tsx scripts/seed-gateway-api-keys.mts
import './worker-env.mts';
import { createGatewayKey, keycloakConfigured, listGatewayKeys } from '../src/lib/gateway-api-keys.ts';

interface SeedKey {
  orgId: string;
  name: string;
}

// SEVERAL keys per tenant, not one. With a single row the Keys screen read as 238 characters of
// table headings — technically populated, and thin enough that a buyer would read it as unused. A real
// bank or insurer issues a separate credential per consuming system, and that is also the point of the
// screen: you can see, and cap, each one independently.
//
// Now that listGatewayKeys is org-scoped (it was realm-wide, which leaked one tenant's client name to
// the other), each tenant sees only its own set.
const SEED_KEYS: readonly SeedKey[] = [
  { orgId: 'org_bharat', name: 'Bharat Union — core banking gateway client' },
  { orgId: 'org_bharat', name: 'Bharat Union — mobile app assistant' },
  { orgId: 'org_bharat', name: 'Bharat Union — collections analytics' },
  { orgId: 'org_suraksha', name: 'Suraksha Life — claims platform gateway client' },
  { orgId: 'org_suraksha', name: 'Suraksha Life — advisor portal assistant' },
  { orgId: 'org_suraksha', name: 'Suraksha Life — underwriting batch jobs' },
];

async function main(): Promise<void> {
  if (!keycloakConfigured()) {
    console.log('Keycloak admin is not configured on this deployment — nothing to seed. Exiting.');
    return;
  }

  // DEFAULT_ORG, deliberately: listGatewayKeys is now org-scoped, and the platform org is the only
  // one that sees every tenant's keys. Calling it with no argument (as this script first did) returned
  // an EMPTY list, so the duplicate check passed for keys that already existed and the script minted a
  // second copy of one. An idempotency check that reads a narrower view than it writes is not a check.
  const existing = await listGatewayKeys('default');
  for (const seed of SEED_KEYS) {
    const already = existing.some((k) => k.name === seed.name && k.owner === seed.orgId);
    if (already) {
      console.log(`skip (already exists): ${seed.name}`);
      continue;
    }
    const { view, apiKey } = await createGatewayKey({ name: seed.name, ownerOrg: seed.orgId });
    console.log(`created: ${view.name} (clientId=${view.clientId}, owner=${view.owner})`);
    console.log(`  one-time key (not stored anywhere — copy now if you need it): ${apiKey}`);
  }
  console.log('done.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FATAL', e);
    process.exit(1);
  });
