// ─── DEMO-READY OpenSearch telemetry seed (WAVE 2, agent D — light the analytics-backed screens) ──
//
// Analytics, FinOps, Observability, and Drift read the durable gateway log from OpenSearch (index
// `offgrid-gateway`), NOT Postgres. Agent C's Postgres seed lights up Overview / Runs / ROI / Evals /
// Audit, but leaves those FOUR screens empty for the two demo tenants. This ships the SAME per-tenant
// run corpus (buildRunCorpus — the single source of the numbers, DRY) into OpenSearch, in the EXACT
// document shape the readers aggregate on, so the four screens light up with numbers that AGREE with
// the Postgres surfaces.
//
//   • BANK    → org_bharat   (Bharat Union — higher volume, lower per-run cost)
//   • INSURER → org_suraksha (Suraksha Life — fewer, heavier assessments)
//
// SAFETY (non-negotiable):
//   • It ONLY builds corpora for org_bharat / org_suraksha, and EVERY doc it writes carries `org`
//     set to that tenant — it can never touch another org's traffic.
//   • IDEMPOTENT: each doc's `_id` is the deterministic run id (run_<hash12>), so a `_bulk` re-run
//     UPSERTS the same docs, never appends duplicates. Re-run it as often as you like.
//   • It targets ONLY the `offgrid-gateway` index via `_bulk`. It never deletes; it only upserts the
//     two tenants' docs. Other orgs' docs (default / wednesdaysol / real traffic) are untouched.
//
// The shape it writes is verified against the READERS (mirrored, not invented):
//   • gateway-aggregator.mjs:232  → { '@timestamp': ISO(ts), source, ...TrafficRecord }
//   • analytics-aggs.ts:48–82     → tokens (sum) · ms (percentiles/sum) · status>=400 (blocked) ·
//                                   model.keyword (byModel) · @timestamp (day/drift/perf) ·
//                                   project.keyword (pipeline narrowing)
//   • analytics.ts:39–53          → caller/gateway · @timestamp/ts · model · tokens · status · ms
//   • finops.ts                   → tokens × model pricing · daily by @timestamp
//   • api/v1/gateway/analytics|logs→ replay each _source as an @offgrid/analytics TrafficRecord
// The pure mapper lives in src/lib/demo/opensearch-telemetry.ts (unit-tested); this file is the thin
// I/O adapter (build body → POST) so the shape logic stays testable with zero I/O.
//
// HOW TO RUN (from the console dir, .env.local / .env.production loaded):
//   npx tsx scripts/seed-tenant-telemetry-opensearch.mts               # ship both tenants
//   npx tsx scripts/seed-tenant-telemetry-opensearch.mts --dry-run     # print shape + counts, no I/O
//   OFFGRID_SEED_TENANT=org_bharat npx tsx scripts/seed-tenant-telemetry-opensearch.mts   # one tenant
//
// It reads the OpenSearch endpoint from the SAME env the readers use:
//   OFFGRID_OPENSEARCH_URL (default http://127.0.0.1:9200) · OFFGRID_GATEWAY_INDEX (default offgrid-gateway)
import './worker-env.mts';
import { BHARAT_PROFILE, SURAKSHA_PROFILE, type TenantProfile } from '../src/lib/tour-demo-seed.ts';
import { buildRunCorpus, rollupCorpus } from '../src/lib/demo/telemetry.ts';
import {
  DEMO_TELEMETRY_ORGS,
  buildBulkBody,
  runMetricToGatewayDoc,
  type DemoTelemetryOrg,
} from '../src/lib/demo/opensearch-telemetry.ts';

const OS_URL = process.env.OFFGRID_OPENSEARCH_URL ?? 'http://127.0.0.1:9200';
const OS_INDEX = process.env.OFFGRID_GATEWAY_INDEX ?? 'offgrid-gateway';

const PROFILES: readonly TenantProfile[] = [BHARAT_PROFILE, SURAKSHA_PROFILE];

function log(...a: unknown[]): void {
  console.log('[seed:telemetry-os]', ...a);
}

/** Assert the profile is one of the two allow-listed demo tenants — the org-scope guard. */
function assertDemoOrg(orgId: string): DemoTelemetryOrg {
  if (!(DEMO_TELEMETRY_ORGS as readonly string[]).includes(orgId)) {
    throw new Error(`refusing to seed telemetry for non-demo org "${orgId}" (allowed: ${DEMO_TELEMETRY_ORGS.join(', ')})`);
  }
  return orgId as DemoTelemetryOrg;
}

/** Bulk-index one tenant's corpus into OpenSearch. UPSERT by deterministic _id ⇒ idempotent. */
async function shipCorpus(profile: TenantProfile, now: number): Promise<void> {
  const org = assertDemoOrg(profile.orgId);
  const corpus = buildRunCorpus(profile, now);
  const roll = rollupCorpus(corpus);
  const body = buildBulkBody(OS_INDEX, org, corpus);
  log(
    `${org}: ${roll.runs} runs · ${roll.totalTokens} tokens · $${roll.totalCostUsd} · ${roll.blocked} blocked · avg ${roll.avgLatencyMs}ms · avg eval ${roll.avgEvalScore}`,
  );

  const r = await fetch(`${OS_URL}/${OS_INDEX}/_bulk`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-ndjson' },
    body,
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    throw new Error(`OpenSearch _bulk failed for ${org}: HTTP ${r.status} ${await r.text().catch(() => '')}`);
  }
  const res = (await r.json()) as { errors?: boolean; items?: unknown[] };
  if (res.errors) {
    throw new Error(`OpenSearch _bulk reported item errors for ${org} — check the index mapping`);
  }
  log(`✓ ${org}: upserted ${res.items?.length ?? corpus.length} docs into ${OS_INDEX}`);
}

/** Print the shape + counts for a tenant WITHOUT any I/O — the safe preview. */
function previewCorpus(profile: TenantProfile, now: number): void {
  const org = assertDemoOrg(profile.orgId);
  const corpus = buildRunCorpus(profile, now);
  const roll = rollupCorpus(corpus);
  log(`${org}: ${roll.runs} runs → ${OS_INDEX} (dry-run, no I/O)`);
  const sample = corpus[0];
  if (sample) {
    log(`  sample doc _id=${sample.id}:`, JSON.stringify(runMetricToGatewayDoc(org, sample)));
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const only = process.env.OFFGRID_SEED_TENANT;
  const profiles = only ? PROFILES.filter((p) => p.orgId === only) : PROFILES;
  if (only && profiles.length === 0) {
    throw new Error(`unknown OFFGRID_SEED_TENANT "${only}" (expected org_bharat or org_suraksha)`);
  }
  const now = Date.now();

  log(`target: ${OS_URL}/${OS_INDEX} — index shape: { '@timestamp', ts, source, org, gateway, model, kind, status, ms, bytes, tokens, promptTokens, completionTokens, project, caller, corrId, costUsd, evalScore, guardrailVerdict, outcome, appKey }`);
  log('org-scoped: every doc carries `org` (org_bharat|org_suraksha); idempotent: _id = run id ⇒ re-run UPSERTS.');

  if (dryRun) {
    for (const p of profiles) previewCorpus(p, now);
    log('dry-run complete — no documents written.');
    return;
  }

  for (const p of profiles) await shipCorpus(p, now);
  log('done — Analytics / FinOps / Observability / Drift now read this corpus per tenant.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed:telemetry-os] FAILED:', err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  });
