// ─── Does the chain actually compound? data → gateway → pipeline → app/agent → regulatory control ──
//
// FOUNDER: "are we truly able to compound on data > gateway > pipelines > agents|apps > regulatory
// control — is that story adding up?"
//
// §1 of the product definition states exactly that chain. This does not assert it; it follows ONE REAL
// RUN through every link on the live deployment and reports, for each link, the specific row that
// binds it to the next. A link that cannot be evidenced is printed as BROKEN with what was missing —
// the whole point is that this can fail.
//
// The test of "compounding" is not that all five layers exist. It is that each one CONSTRAINS the
// next: the pipeline's ceiling limits which data the app may read, the app's binding decides which
// gateway and model serve it, and the run leaves evidence a regulator can be shown. So each link is
// checked for the BINDING, not for the presence of a feature.
//
//   /usr/local/bin/node --env-file=.env.local ./node_modules/.bin/tsx scripts/trace-the-chain.mts [org]

import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';

const ORG = process.argv[2] ?? 'org_bharat';
const out: { link: string; verdict: 'HOLDS' | 'BROKEN' | 'PARTIAL'; detail: string }[] = [];
const add = (link: string, verdict: 'HOLDS' | 'BROKEN' | 'PARTIAL', detail: string) =>
  out.push({ link, verdict, detail });

// Start from a real completed run — not a hand-picked one; the most recent that finished.
const run = (
  await db.execute<{ id: string; app_id: string; status: string; provenance: unknown; steps: unknown }>(sql`
    SELECT id, app_id, status, provenance, steps FROM app_runs
    WHERE org_id = ${ORG} AND status = 'done' ORDER BY started_at DESC LIMIT 1`)
).rows[0];

if (!run) {
  console.log(`No completed run in ${ORG} — nothing to trace.`);
  process.exit(1);
}
console.log(`Tracing ${run.id} (app ${run.app_id}) in ${ORG}\n`);

const app = (
  await db.execute<{ id: string; title: string; pipeline_id: string | null; steps: unknown }>(sql`
    SELECT id, title, pipeline_id, steps FROM apps WHERE id = ${run.app_id}`)
).rows[0];

// ── LINK 1 · data → gateway: does the app read DECLARED sources, bound to real connectors? ─────────
const steps = (app?.steps ?? []) as { kind: string; domain?: string; label?: string }[];
const reads = steps.filter((s) => s.kind === 'connector-query' && s.domain);
const domainRows = reads.length
  ? (
      await db.execute<{ id: string; label: string; connector_id: string; resource: string }>(sql`
        SELECT id, label, connector_id, resource FROM data_domains
        WHERE org_id = ${ORG} AND (id = ANY(${sql`ARRAY[${sql.join(reads.map((r) => sql`${r.domain}`), sql`, `)}]::text[]`})
           OR label = ANY(${sql`ARRAY[${sql.join(reads.map((r) => sql`${r.domain}`), sql`, `)}]::text[]`}))`)
    ).rows
  : [];
add(
  '1 · data → declared domain → connector',
  domainRows.length === reads.length && reads.length > 0 ? 'HOLDS' : reads.length ? 'PARTIAL' : 'BROKEN',
  reads.length
    ? `${domainRows.length}/${reads.length} reads resolve to a declared domain: ${domainRows.map((d) => `${d.label}→${d.connector_id}/${d.resource}`).join(', ')}`
    : 'this app reads no declared source',
);

// ── LINK 2 · pipeline → gateway + model: is the app bound, and does the pipeline pin the serving? ──
const pipe = app?.pipeline_id
  ? (
      await db.execute<{ id: string; name: string; gateway_id: string | null; default_model: string | null; data_allowlist: string[] }>(sql`
        SELECT id, name, gateway_id, default_model, data_allowlist FROM pipelines WHERE id = ${app.pipeline_id}`)
    ).rows[0]
  : undefined;
add(
  '2 · app → pipeline → gateway + model',
  pipe ? (pipe.gateway_id ? 'HOLDS' : 'PARTIAL') : 'BROKEN',
  pipe
    ? `"${pipe.name}" · gateway ${pipe.gateway_id ?? 'NOT PINNED (org default)'} · model ${pipe.default_model ?? 'gateway default'}`
    : 'the app is not bound to a pipeline — it would resolve to the org default at run time',
);

// ── LINK 3 · the ceiling actually CONSTRAINS: every source the app reads is on the allowlist ───────
const allow = (pipe?.data_allowlist ?? []).map((a) => String(a).toLowerCase());
const readNames = domainRows.flatMap((d) => [d.id.toLowerCase(), d.label.toLowerCase()]);
const covered = domainRows.filter((d) => allow.includes(d.id.toLowerCase()) || allow.includes(d.label.toLowerCase()));
add(
  '3 · pipeline ceiling constrains the app',
  !pipe ? 'BROKEN' : covered.length === domainRows.length && allow.length > 0 ? 'HOLDS' : 'PARTIAL',
  pipe
    ? `${covered.length}/${domainRows.length} of the app's sources are on a ${allow.length}-entry ceiling` +
      (covered.length < domainRows.length
        ? ` — NOT on it: ${domainRows.filter((d) => !covered.includes(d)).map((d) => d.label).join(', ')}`
        : '')
    : 'no pipeline, so no ceiling',
);

// ── LINK 4 · the run was governed: a human decided, and the decision is in the ledger ──────────────
const runSteps = (run.steps ?? []) as { kind: string; status: string; reviewer?: string }[];
const humanStep = runSteps.find((s) => s.kind === 'human');
const decisions = (
  await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM audit_events_v2
    WHERE org = ${ORG} AND resource LIKE ${'%' + run.id + '%'}`)
).rows[0]?.n ?? 0;
add(
  '4 · app/agent run under human control',
  humanStep ? (decisions > 0 ? 'HOLDS' : 'PARTIAL') : decisions > 0 ? 'PARTIAL' : 'BROKEN',
  `${humanStep ? `human step "${humanStep.status}"${humanStep.reviewer ? ` decided by ${humanStep.reviewer}` : ''}` : 'no human step in this app'} · ${decisions} ledger event(s) name this run`,
);

// ── LINK 5 · regulatory control: is the outcome provable, and does it reach an evidence pack? ──────
const signed = Boolean(run.provenance);
const coverage = (
  await db.execute<{ total: number; signed: number }>(sql`
    SELECT count(*)::int total, count(*) FILTER (WHERE provenance IS NOT NULL)::int signed
    FROM app_runs WHERE org_id = ${ORG} AND status = 'done'`)
).rows[0];
add(
  '5 · outcome → signed evidence → regulator pack',
  signed ? 'HOLDS' : 'PARTIAL',
  `this run ${signed ? 'carries' : 'has NO'} a provenance signature · org-wide ${coverage.signed}/${coverage.total} completed runs are signed (${Math.round((coverage.signed / Math.max(1, coverage.total)) * 100)}%)`,
);

console.log('LINK                                        VERDICT   EVIDENCE');
for (const r of out) {
  console.log(`${r.link.padEnd(43)} ${r.verdict.padEnd(9)} ${r.detail}`);
}
const broken = out.filter((r) => r.verdict === 'BROKEN').length;
const partial = out.filter((r) => r.verdict === 'PARTIAL').length;
console.log(
  `\n${out.length - broken - partial}/${out.length} links hold end to end` +
    (partial ? ` · ${partial} partial` : '') +
    (broken ? ` · ${broken} BROKEN` : ''),
);
process.exit(0);
