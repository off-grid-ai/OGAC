// ─── Run ONE case end-to-end and print every step's real detail ────────────────────────────────────────
//
// The diagnostic that kept misleading me printed `outcome` while `errorResult` writes to `detail`, so a named
// failure looked like silence. This prints BOTH for every step, plus the step output, so a run can be read
// honestly.
//
// RUN (on the server): npx tsx scripts/run-one-case.mts <app-slug> [org-id]
import './worker-env.mts';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { getAppBySlug } from '../src/lib/apps-store.ts';
import { runApp } from '../src/lib/app-run.ts';

const slug = process.argv[2] ?? 'bh-reimbursement';
const orgId = process.argv[3] ?? 'org_bharat';

const app = await getAppBySlug(slug, orgId);
if (!app) throw new Error(`no app "${slug}" in ${orgId}`);
console.log(`app ${app.id} "${app.name}" · ${app.steps.length} step(s)`);

// Take a REAL open record from the domain the app reads first, exactly as the case picker does — nothing typed.
const { primaryDomainLabel, isActionableRecord, toCaseCandidate } = await import('../src/lib/app-case-candidates.ts');
const { listDomains } = await import('../src/lib/data-domains-store.ts');
const { listConnectors } = await import('../src/lib/store.ts');
const { execConnectorRead } = await import('../src/lib/connector-exec.ts');

const { resolveDomainByIdOrLabel } = await import('../src/lib/app-run.ts');
const { resolveDomain } = await import('../src/lib/data-domains.ts');
const label = primaryDomainLabel(app.steps as { kind?: string; domain?: string }[]);
const domains = await listDomains(orgId);
const domain = resolveDomainByIdOrLabel(label ?? '', domains, resolveDomain);
if (!domain) throw new Error(`no domain "${label}"`);
const connector = (await listConnectors(orgId)).find((c) => c.id === domain.connectorId);
if (!connector) throw new Error(`no connector ${domain.connectorId}`);

const read = await execConnectorRead(
  { type: connector.type, endpoint: connector.endpoint, id: connector.id, orgId },
  { resource: domain.resource, op: 'read', limit: 20, binding: { orgId, domainId: domain.id } },
);
if (!read.ok) throw new Error(`could not list cases: ${JSON.stringify(read.failure)}`);
const open = (read.ok ? read.result.rows : []).filter(isActionableRecord);
if (open.length === 0) throw new Error('no open records to work on');
// Optional 3rd arg: which open case to run. Needed to exercise a REJECTION as well as an approval —
// a demo where every case passes proves nothing about the decision.
const which = Math.min(Math.max(Number(process.argv[4] ?? 0) || 0, 0), open.length - 1);
const candidate = toCaseCandidate(open[which], which);
console.log(`case: ${candidate.label} ${candidate.detail ?? ''}`);

// Submit the case exactly as the browser does: the readable label as the text, the RECORD as the case.
const { buildTriggerInput } = await import('../src/lib/trigger-dispatch.ts');
const input = buildTriggerInput('webhook', {
  input: { input: [candidate.label, candidate.detail].filter(Boolean).join(' · ') },
  case: candidate.record,
});
const actor = orgId === 'org_suraksha' ? 'demo-insurer@getoffgridai.co' : 'demo-bank@getoffgridai.co';
const outcome = await runApp(app, input, {
  orgId,
  actor,
  input,
  asker: { id: actor, groups: [], clearance: 'internal' },
});

console.log(`\nrun ${outcome.runId} → ${outcome.status}`);
for (const step of outcome.steps) {
  console.log(`\n── ${step.kind} [${step.status}]`);
  if (step.detail) console.log(`   detail: ${step.detail}`);
  if (step.output) console.log(`   output: ${String(step.output).slice(0, 700)}`);
}

await db.execute(sql`SELECT 1`);
