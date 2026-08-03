// "Which models processed data classified Confidential or above?" — the question that could not be
// answered. Run against live data now that domains carry a grade.
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { getApp } from '../src/lib/apps-store.ts';
import { listDomains } from '../src/lib/data-domains-store.ts';
import { runSensitivity, describeSensitivity, atOrAbove } from '../src/lib/run-sensitivity.ts';

const ORG = 'org_bharat';
const domains = await listDomains(ORG);
const byKey = new Map<string, { label: string; classification?: string | null }>();
for (const d of domains) {
  byKey.set(d.id, { label: d.label, classification: d.classification ?? null });
  byKey.set(d.label, { label: d.label, classification: d.classification ?? null });
}

// WHERE THE MODEL ACTUALLY LIVES, enumerated rather than assumed: `agent_runs` has no model column
// (id, agent_id, query, answer, status, steps, citations, checks, provenance, started_at, org_id).
// The attribution is on the AUDIT LEDGER — audit_events_v2.model, joined by run_id, and all 92 rows
// that carry a model also carry the run_id. An app run reaches it through the child agent run its
// agent step spawned.
const runs = await db.execute<{ id: string; app_id: string; model: string | null }>(sql`
  SELECT r.id, r.app_id,
         (SELECT a.model FROM audit_events_v2 a
           WHERE a.org = r.org_id AND a.model IS NOT NULL
             AND a.run_id IN (
               SELECT e->>'childRunId' FROM jsonb_array_elements(r.steps) e WHERE e->>'childRunId' IS NOT NULL)
           LIMIT 1) model
  FROM app_runs r WHERE r.org_id = ${ORG} ORDER BY r.started_at DESC LIMIT 40`);

const byModel = new Map<string, { confidential: number; total: number }>();
let sensitive = 0;
for (const r of runs.rows) {
  const app = await getApp(r.app_id, ORG);
  const read = (app?.steps ?? [])
    .filter((s) => s.kind === 'connector-query')
    .map((s) => byKey.get((s as { domain?: string }).domain ?? ''))
    .filter((d): d is { label: string; classification?: string | null } => Boolean(d));
  const s = runSensitivity(read);
  const model = r.model ?? '(model not attributed)';
  const e = byModel.get(model) ?? { confidential: 0, total: 0 };
  e.total++;
  if (atOrAbove(s, 'confidential')) { e.confidential++; sensitive++; }
  byModel.set(model, e);
}
console.log(`WHICH MODELS PROCESSED CONFIDENTIAL-OR-ABOVE DATA (last ${runs.rows.length} runs, ${ORG})\n`);
for (const [model, e] of [...byModel].sort((a, b) => b[1].confidential - a[1].confidential)) {
  console.log(`  ${model.padEnd(34)} ${e.confidential}/${e.total} runs`);
}
console.log(`\n${sensitive} of ${runs.rows.length} runs read confidential or restricted data`);

// And the sample sentence a DPO reads on a run.
const one = runs.rows[0];
const app = one ? await getApp(one.app_id, ORG) : null;
if (app) {
  const read = (app.steps ?? [])
    .filter((s) => s.kind === 'connector-query')
    .map((s) => byKey.get((s as { domain?: string }).domain ?? ''))
    .filter((d): d is { label: string; classification?: string | null } => Boolean(d));
  console.log(`\nexample — ${app.title}: "${describeSensitivity(runSensitivity(read))}"`);
}
process.exit(0);
