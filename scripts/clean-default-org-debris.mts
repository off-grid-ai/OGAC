// ─── Remove the DEV DEBRIS from the platform org, and nothing else ─────────────────────────────────
//
// G-207. Signing in as a non-tenant identity lands in `default` and shows a decade of development
// leftovers: projects called "Op" and "OPOP", conversations called "hi" and "Reply with exactly: HELLO
// FROM CONSOLE", duplicate "Claims Assistant" templates from a builder test.
//
// WHAT THIS DOES NOT TOUCH, and why — because "clean the default org" is exactly the instruction that
// breaks a platform. Inventoried first: 38 tables hold `default` rows and most are NOT debris:
//
//   · presidio_anonymizer_policy — the PAN / Aadhaar / IFSC / UPI masking rules. Deleting it would
//     quietly weaken masking for anything that inherits the platform default.
//   · feature_flags — semantic cache, content capture. Platform behaviour.
//   · custom_roles (svc-*) — real service-account roles for the mobile app and ProvIt.
//   · gateways gw_seed_default_* — the provider catalogue a new tenant picks from.
//   · pipelines pl_seed_default_* AND pl_system_ai_quality_judge__default — the SYSTEM eval judge
//     runs on that last one; removing it breaks evaluation for every tenant.
//   · connectors con_* , abac_rules, routing_rules, api_keys, devices, datasets — seeded baseline.
//   · anything owned by service@offgrid.local, seed@offgrid.local, or a *.example demo persona.
//
// Verified before writing a line: NO tenant row references any `default` row (0 across
// pipelines→gateways, apps→pipelines, agents→pipelines, domains→connectors), so nothing here can pull
// the demo tenants down with it.
//
// THE RULE APPLIED: only rows authored by a named HUMAN DEVELOPER (@wednesday.is) in the platform org,
// plus template rows whose titles are self-evidently builder tests. Everything else stays.
//
//   /usr/local/bin/node --env-file=.env.local ./node_modules/.bin/tsx scripts/clean-default-org-debris.mts [--apply]

import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';

const APPLY = process.argv.includes('--apply');
const DEV = ['mac@wednesday.is', 'mohammed.ali@wednesday.is', 'diksha.sharma@wednesday.is'];
// Postgres needs the array typed; a bare JS array binds as a record and fails with 42809.
const DEVS = sql`ARRAY[${sql.join(DEV.map((d) => sql`${d}`), sql`, `)}]::text[]`;

async function count(label: string, query: ReturnType<typeof sql>) {
  const r = await db.execute<{ n: number }>(query);
  const n = r.rows[0]?.n ?? 0;
  console.log(`${label.padEnd(52)} ${n}`);
  return n;
}

async function run(label: string, query: ReturnType<typeof sql>) {
  if (!APPLY) return;
  const r = await db.execute(query);
  console.log(`  removed ${r.rowCount ?? 0} — ${label}`);
}

console.log(APPLY ? '── APPLYING ──\n' : '── DRY RUN (pass --apply to delete) ──\n');
console.log('WOULD REMOVE (dev-authored rows in the platform org):');

// The developers' chat work: projects, their conversations, and everything hanging off them.
await count('chat projects', sql`SELECT count(*)::int n FROM chat_projects WHERE org_id='default' AND user_id = ANY(${DEVS})`);
await count('chat conversations', sql`SELECT count(*)::int n FROM chat_conversations WHERE org_id='default' AND user_id = ANY(${DEVS})`);
await count('chat artifacts', sql`SELECT count(*)::int n FROM chat_artifacts WHERE org_id='default' AND user_id = ANY(${DEVS})`);
await count('apps', sql`SELECT count(*)::int n FROM apps WHERE org_id='default' AND owner_id = ANY(${DEVS})`);
await count('studio templates (builder tests)', sql`
  SELECT count(*)::int n FROM studio_templates
  WHERE org_id='default' AND (title = 'Studio Flowtest' OR (title = 'Claims Assistant' AND id <> 'st_demo'))`);

console.log('\nKEPT (platform baseline — named so the decision is auditable):');
await count('  seeded apps (service@ / seed@)', sql`SELECT count(*)::int n FROM apps WHERE org_id='default' AND owner_id <> ALL(${DEVS})`);
await count('  seeded pipelines incl. the eval judge', sql`SELECT count(*)::int n FROM pipelines WHERE org_id='default'`);
await count('  seeded connectors', sql`SELECT count(*)::int n FROM connectors WHERE org_id='default'`);
await count('  gateway catalogue', sql`SELECT count(*)::int n FROM gateways WHERE org_id='default'`);
await count('  masking policy / flags / roles / abac', sql`
  SELECT (SELECT count(*) FROM presidio_anonymizer_policy WHERE org_id='default')
       + (SELECT count(*) FROM feature_flags WHERE org_id='default')
       + (SELECT count(*) FROM custom_roles WHERE org_id='default')
       + (SELECT count(*) FROM abac_rules WHERE org_id='default') AS n`);

if (APPLY) {
  console.log('\napplying…');
  // Children first, so nothing is orphaned if a later statement fails.
  await run('chunks of dev project documents', sql`
    DELETE FROM chat_chunks WHERE project_id IN (
      SELECT id FROM chat_projects WHERE org_id='default' AND user_id = ANY(${DEVS}))`);
  await run('dev project documents', sql`
    DELETE FROM chat_documents WHERE project_id IN (
      SELECT id FROM chat_projects WHERE org_id='default' AND user_id = ANY(${DEVS}))`);
  await run('dev chat artifacts', sql`
    DELETE FROM chat_artifacts WHERE org_id='default' AND user_id = ANY(${DEVS})`);
  await run('dev chat messages', sql`
    DELETE FROM chat_messages WHERE conversation_id IN (
      SELECT id FROM chat_conversations WHERE org_id='default' AND user_id = ANY(${DEVS}))`);
  await run('dev conversations', sql`
    DELETE FROM chat_conversations WHERE org_id='default' AND user_id = ANY(${DEVS})`);
  await run('dev project memory', sql`
    DELETE FROM chat_project_memory WHERE project_id IN (
      SELECT id FROM chat_projects WHERE org_id='default' AND user_id = ANY(${DEVS}))`);
  await run('dev project members', sql`
    DELETE FROM chat_project_members WHERE project_id IN (
      SELECT id FROM chat_projects WHERE org_id='default' AND user_id = ANY(${DEVS}))`);
  await run('dev projects', sql`
    DELETE FROM chat_projects WHERE org_id='default' AND user_id = ANY(${DEVS})`);
  // Dev apps: their runs, versions and materialised agents go with them.
  await run('dev app runs', sql`
    DELETE FROM app_runs WHERE org_id='default' AND app_id IN (
      SELECT id FROM apps WHERE org_id='default' AND owner_id = ANY(${DEVS}))`);
  await run('dev app versions', sql`
    DELETE FROM app_versions WHERE org_id='default' AND app_id IN (
      SELECT id FROM apps WHERE org_id='default' AND owner_id = ANY(${DEVS}))`);
  await run('agents owned by dev apps', sql`
    DELETE FROM custom_agents WHERE org_id='default' AND owner_app_id IN (
      SELECT id FROM apps WHERE org_id='default' AND owner_id = ANY(${DEVS}))`);
  await run('dev apps', sql`
    DELETE FROM apps WHERE org_id='default' AND owner_id = ANY(${DEVS})`);
  await run('builder-test templates', sql`
    DELETE FROM studio_templates
    WHERE org_id='default' AND (title = 'Studio Flowtest' OR (title = 'Claims Assistant' AND id <> 'st_demo'))`);
}

console.log('\n── after ──');
await count('default projects remaining', sql`SELECT count(*)::int n FROM chat_projects WHERE org_id='default'`);
await count('default conversations remaining', sql`SELECT count(*)::int n FROM chat_conversations WHERE org_id='default'`);
await count('default apps remaining', sql`SELECT count(*)::int n FROM apps WHERE org_id='default'`);
await count('default templates remaining', sql`SELECT count(*)::int n FROM studio_templates WHERE org_id='default'`);
console.log('\nTENANTS UNTOUCHED — the number that matters:');
await count('org_bharat apps', sql`SELECT count(*)::int n FROM apps WHERE org_id='org_bharat'`);
await count('org_suraksha apps', sql`SELECT count(*)::int n FROM apps WHERE org_id='org_suraksha'`);
await count('tenant pipelines', sql`SELECT count(*)::int n FROM pipelines WHERE org_id <> 'default'`);
await count('the AI Quality Judge pipeline', sql`SELECT count(*)::int n FROM pipelines WHERE id='pl_system_ai_quality_judge__default'`);
process.exit(0);
