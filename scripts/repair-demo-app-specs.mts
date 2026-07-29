// ─── Make the seeded demo apps EDITABLE ─────────────────────────────────────────────────────────────
//
// WHY. "I should be able to edit" is an explicit requirement (docs/APP_AS_PRODUCT.md §2), and it does not
// currently hold for a single seeded demo app. updateApp re-validates the whole spec on every save, and
// the seeded specs fail it:
//   connector-query step sN: needs a domain binding
//   agent step sN: needs agentId or inlineAgent
//   output step sN: needs a sink
// So the Build screen renders, the person edits, presses save — and it is rejected. The surface looks
// finished and is not.
//
// WHAT. Fills the three missing bindings using each tenant's REAL context: a data domain that exists in
// that org, a custom agent that exists in that org, and the `report` sink (a retained report, never a
// side-effecting channel — a demo app must not be able to email or post anywhere when someone presses
// Run).
//
// HONEST BY CONSTRUCTION: an org with no data domain or no agent to bind is REPORTED and skipped, never
// bound to an invented id. A fabricated binding would pass validation and then fail at run time, which is
// strictly worse than an honest refusal.
//
// IDEMPOTENT: a step that already carries its binding is left exactly as it is.
//
// RUN: npx tsx scripts/repair-demo-app-specs.mts
import './worker-env.mts';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { validateAppSpec, type AppSpec, type AppStep } from '../src/lib/app-model.ts';
import { listDomains } from '../src/lib/data-domains-store.ts';
import { listCustomAgents } from '../src/lib/store.ts';

const ORGS = ['org_bharat', 'org_suraksha'] as const;

for (const orgId of ORGS) {
  const [domains, agents] = await Promise.all([
    listDomains(orgId).catch(() => []),
    listCustomAgents(orgId).catch(() => []),
  ]);
  // Only domains with a real connector binding are usable — the same rule the builder applies.
  const domain = domains.find((d) => d.connectorId && d.resource) ?? domains[0];
  const agent = agents[0];

  const rows = (await db.execute(sql`
    SELECT id, title, steps FROM apps WHERE org_id = ${orgId}
  `)) as unknown as { rows: { id: string; title: string; steps: AppStep[] | null }[] };

  let repaired = 0;
  const skipped: string[] = [];

  for (const row of rows.rows ?? []) {
    const steps = Array.isArray(row.steps) ? row.steps : [];
    if (steps.length === 0) continue;

    let changed = false;
    const missing = new Set<string>();

    const next = steps.map((step) => {
      if (step.kind === 'connector-query' && !(step as { domain?: string }).domain?.trim()) {
        if (!domain) {
          missing.add('a data domain');
          return step;
        }
        changed = true;
        // The domain ID, not the label. resolveDomainByIdOrLabel matches an exact id FIRST and only then
        // falls back to a phrase rule engine for labels — and that engine matches human phrases, not bare
        // table names, so "invoices" resolved to null and the read step errored at run time. Ids are stable
        // and unambiguous; this is what the compiler itself emits.
        return { ...step, domain: domain.id };
      }
      if (
        step.kind === 'agent' &&
        !(step as { agentId?: string }).agentId &&
        !(step as { inlineAgent?: unknown }).inlineAgent
      ) {
        if (!agent) {
          missing.add('an agent');
          return step;
        }
        changed = true;
        return { ...step, agentId: (agent as { id: string }).id };
      }
      if (step.kind === 'output' && !(step as { sink?: string }).sink) {
        changed = true;
        // `report` deliberately: a retained report cannot email, post or call out. A demo app must never
        // be able to act on the world because somebody pressed Run.
        return { ...step, sink: 'report' };
      }
      return step;
    });

    if (missing.size > 0) {
      skipped.push(`${row.title} — this org has no ${[...missing].join(' and no ')}`);
      continue;
    }
    if (!changed) continue;

    await db.execute(sql`UPDATE apps SET steps = ${JSON.stringify(next)}::jsonb WHERE id = ${row.id}`);
    repaired += 1;

    // Prove the point of the whole exercise: the spec must now PASS the validator that save runs.
    const full = (await db.execute(sql`SELECT * FROM apps WHERE id = ${row.id}`)) as unknown as {
      rows: AppSpec[];
    };
    // validateAppSpec returns { ok, errors } — not a bare array.
    const result = validateAppSpec({ ...(full.rows?.[0] as AppSpec), steps: next });
    console.log(
      result.ok
        ? `${orgId} · ${row.title} — now saveable`
        : `${orgId} · ${row.title} — STILL INVALID: ${result.errors.join('; ')}`,
    );
  }

  console.log(`${orgId}: repaired ${repaired} app(s)`);
  for (const s of skipped) console.log(`  skipped: ${s}`);
}
