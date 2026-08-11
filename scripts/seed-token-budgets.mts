// ─── Demo seed: token BUDGETS (the empty half of /runtime/api-budgets) ────────────────────────────
//
// WHY. /runtime/api-budgets redirects to its Keys tab, which already has 6 real Keycloak-backed
// gateway keys (scripts/seed-gateway-api-keys.mts). The Budgets tab (TokenBudgets, GET/POST
// /api/v1/finops/budgets) had ZERO rows on either tenant — "No budgets issued yet." Confirmed live
// (2026-08-11): `SELECT * FROM token_budgets` returned no rows at all.
//
// WHAT A BUDGET IS HERE — READ BEFORE CHANGING THE SUBJECTS BELOW. A budget is keyed by `subject`,
// metered against the gateway's OpenSearch call history filtered on an EXACT `caller.keyword` match
// (src/lib/token-budgets.ts usageFor). `caller` is stamped from the `x-offgrid-user` header
// (gatewayAttribution), which for a signed-in console user is their session email. It is NOT tied to
// the 6 Keycloak gateway API keys at all — those are M2M service-account clients with no attribution
// hook into this table (LiteLLM's own native per-key $ budget is a SEPARATE surface — the "Virtual
// keys & budgets" panel on the Routing view, out of scope here). So "cap per key" isn't literally
// wireable; the closest real, live-metered equivalent is capping the identity that actually generates
// attributed gateway traffic for that tenant.
//
// SUBJECT CHOICE. The real demo-viewer login for each tenant (demo-insurer@getoffgridai.co /
// demo-bank@getoffgridai.co — the exact accounts scripts/seed-bfsi-demo.mjs and every screenshot
// harness sign in as, and the identity a buyer explores the live console AS) already shows up as a
// genuine `caller` in the gateway's OpenSearch history. Capping THAT subject means the budget is not
// a dead prop: every chat/agent/sandbox call that reviewer makes while exploring the console keeps
// metering against it in real time, and pctUsed will visibly climb over the demo period — an
// org-level `org:<slug>` cap (the OTHER subject convention the UI's placeholder documents) would
// instead sit frozen at 0% forever, because nothing in the platform ever stamps caller="org:<slug>"
// literally.
//
// SIZE. Sized against each tenant's REAL recorded 90-day gateway volume (queried live from the
// `offgrid-gateway` OpenSearch index via the same opensearchFetch seam token-budgets.ts uses):
//   • org_suraksha: 242,554 tokens / 90d ≈ 80,851/mo run rate  → cap 80,000 tokens/mo
//   • org_bharat:   197,431 tokens / 90d ≈ 65,810/mo run rate  → cap 66,000 tokens/mo
// i.e. a safety-rail cap at roughly the tenant's own current monthly gateway run-rate — real,
// derived, not a round number pulled from nowhere.
//
// HOW. Calls setBudget() directly — the exact function POST /api/v1/finops/budgets calls. setBudget
// is already an idempotent UPSERT (ON CONFLICT (subject) DO UPDATE), so re-running this script is
// safe and converges to the same allocation rather than duplicating rows.
//
// RUN (on the box, .env.local loaded):
//   /usr/local/bin/node --env-file=.env.local node_modules/.bin/tsx scripts/seed-token-budgets.mts
import './worker-env.mts';
import { getBudget, setBudget } from '../src/lib/token-budgets.ts';

const log = (...a: unknown[]) => console.log('[seed:token-budgets]', ...a);

interface Seed {
  subject: string;
  allocatedTokens: number;
  period: 'monthly' | 'weekly' | 'daily';
  createdBy: string;
}

const SEEDS: readonly Seed[] = [
  {
    subject: 'demo-insurer@getoffgridai.co',
    allocatedTokens: 80_000,
    period: 'monthly',
    createdBy: 'seed:token-budgets',
  },
  {
    subject: 'demo-bank@getoffgridai.co',
    allocatedTokens: 66_000,
    period: 'monthly',
    createdBy: 'seed:token-budgets',
  },
];

async function main(): Promise<void> {
  for (const seed of SEEDS) {
    const before = await getBudget(seed.subject);
    await setBudget(seed.subject, seed.allocatedTokens, seed.period, seed.createdBy);
    log(
      before
        ? `updated: ${seed.subject} → ${seed.allocatedTokens.toLocaleString()} tokens/${seed.period} (was ${before.allocatedTokens.toLocaleString()})`
        : `created: ${seed.subject} → ${seed.allocatedTokens.toLocaleString()} tokens/${seed.period}`,
    );
  }
  log('done.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[seed:token-budgets] FATAL', e);
    process.exit(1);
  });
