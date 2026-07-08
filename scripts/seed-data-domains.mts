// ─── Demo data-domain seed script (Builder Epic task #106) ────────────────────────────────────────
//
// Declares the demo connectors + data-domains bound to the REAL on-prem data sources
// (deploy/onprem/data-sources.yml) and the ready-made "Reimbursement Approval" sample app, so the
// flagship reimbursement use case is clickable end-to-end. Same idempotent logic as the
// POST /api/v1/admin/data-domains/seed route, but runnable directly against the DB (no auth/HTTP).
//
// HOW TO RUN (from the console dir, with .env.local / .env.production loaded):
//   npm run seed:domains                 # seed default org, incl. sample app
//   OFFGRID_SEED_ORG=<orgId> npm run seed:domains
//   OFFGRID_SEED_SAMPLE_APP=0 npm run seed:domains   # skip the sample app
//
// ON THE SERVER (git is dead there — deploy the source via rsync, then, per DEPLOY.md, call node by
// its absolute path):
//   /usr/local/bin/node --experimental-strip-types --import ./scripts/... — or simply `npm run seed:domains`
//   if npm/tsx are available. This talks straight to Postgres via DATABASE_URL in the server's .env.
//
// IMPORT ORDER IS LOAD-BEARING: worker-env.mts MUST be first so .env.* is loaded before @/db builds
// its pg Pool (see scripts/app-worker.mts for the rationale).

import './worker-env.mts';
import { createConnector, listConnectors } from '../src/lib/store.ts';
import { createDomain, listDomains } from '../src/lib/data-domains-store.ts';
import { createApp, listApps, updateApp } from '../src/lib/apps-store.ts';
import { listPipelines } from '../src/lib/pipelines.ts';
import { resolvePipelineIdForApp } from '../src/lib/bfsi-app-pipeline-map.ts';
import {
  buildReimbursementAppSpec,
  planConnectors,
  planDomains,
} from '../src/lib/data-domains-demo-seed.ts';

const log = (...a: unknown[]) => console.log('[seed:domains]', ...a);

async function main(): Promise<void> {
  const orgId = process.env.OFFGRID_SEED_ORG || 'default';
  const wantSampleApp = process.env.OFFGRID_SEED_SAMPLE_APP !== '0';
  const ownerId = process.env.OFFGRID_SEED_OWNER || 'seed@offgrid.local';
  log(`org=${orgId} sampleApp=${wantSampleApp}`);

  // 1. Connectors (idempotent by name).
  const existingConnectors = await listConnectors(orgId);
  const connPlan = planConnectors(existingConnectors.map((c) => ({ id: c.id, name: c.name })));
  for (const c of connPlan.toCreate) {
    await createConnector({ name: c.name, type: c.type, endpoint: c.endpoint, description: c.description, orgId, custom: true });
    log(`+ connector "${c.name}" (${c.type})`);
  }
  if (connPlan.present.length) log(`= connectors present: ${connPlan.present.map((c) => c.name).join(', ')}`);

  // 2. name → real id map from the current connector set.
  const allConnectors = await listConnectors(orgId);
  const connectorsByName = new Map(allConnectors.map((c) => [c.name.trim().toLowerCase(), c.id]));

  // 3. Domains (idempotent by label; only bound to real connectors).
  const existingDomains = await listDomains(orgId);
  const domPlan = planDomains(existingDomains.map((d) => ({ id: d.id, label: d.label })), connectorsByName);
  for (const d of domPlan.toCreate) {
    await createDomain(
      { label: d.label, connectorId: d.connectorId, resource: d.resource, aliases: d.aliases, opHints: d.opHints },
      orgId,
    );
    log(`+ domain "${d.label}" → ${d.connectorId}:${d.resource}`);
  }
  if (domPlan.present.length) log(`= domains present: ${domPlan.present.map((d) => d.label).join(', ')}`);
  if (domPlan.unbacked.length) {
    log(`! domains SKIPPED (backing connector absent — never fabricated): ${domPlan.unbacked.map((d) => `${d.label}(${d.connectorKey})`).join(', ')}`);
  }

  // 4. Sample app (idempotent by title) — bound to its governing pipeline so it reads
  //    "Runs on: Reimbursement Governance" instead of "Ungoverned". The binding is resolved from the
  //    live pipeline library by name (pure rule in bfsi-app-pipeline-map.ts). A re-run UPDATES the
  //    binding on the already-present app so it self-heals if the pipelines were seeded afterwards.
  if (wantSampleApp) {
    const [existingApps, pipelines] = await Promise.all([listApps(orgId), listPipelines(orgId).catch(() => [])]);
    const pipelineIdByName = new Map(pipelines.map((p) => [p.name, p.id]));
    const spec = buildReimbursementAppSpec(orgId, ownerId);
    const pipelineId = resolvePipelineIdForApp(spec.title, pipelineIdByName);
    if (!pipelineId) log(`! no pipeline resolved for "${spec.title}" — seed the pipelines first (POST /api/v1/admin/pipelines/seed)`);
    const existing = existingApps.find((a) => a.title.trim().toLowerCase() === spec.title.trim().toLowerCase());
    if (!existing) {
      const app = await createApp(orgId, ownerId, {
        title: spec.title,
        summary: spec.summary,
        visibility: spec.visibility,
        trigger: spec.trigger,
        steps: spec.steps,
        edges: spec.edges,
        pipelineId,
      });
      log(`+ sample app "Reimbursement Approval" → ${app.id} (pipeline ${pipelineId ?? 'none'})`);
    } else {
      await updateApp(existing.id, orgId, { pipelineId });
      log(`= sample app "Reimbursement Approval" present → pipeline ${pipelineId ?? 'none'}`);
    }
  }

  log('done.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed:domains] FAILED:', err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  });
